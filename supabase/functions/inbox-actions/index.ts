// Staff actions on an Inbox conversation (Phase D). Adapted from Acapolite's
// whatsapp-qa-feed action dispatcher: ONE endpoint, one `action` field, all
// server-side (never a direct client table write for these) so every
// action gets the same permission check, workspace-membership
// cross-check, and audit trail - assign/return_to_ai/resolve/reopen/reply/
// mark_read/add_note.
//
// Unlike the source's separate whatsapp_staff_actions table, every action
// here is logged into the EXISTING workspace_activity_log shared across
// every StabiFlow module (Content, Campaigns, Integrations) - the durable
// architecture is explicit that Inbox must share it too, not fork its own
// audit trail.
import { bearerToken, createCallerClient, createServiceClient, getCallerUserId, hasWorkspacePermission, json } from "../_shared/contentAuth.ts";
import { cleanReply } from "../_shared/inbox/replyGuardrails.ts";
import type { WhatsAppSendCredential, WhatsAppTemplateParameter } from "../_shared/inbox/whatsappSend.ts";
import { isWhatsAppMockMode, REAL_WHATSAPP_PROVIDER } from "../_shared/inbox/whatsappSendProvider.ts";
import { MOCK_WHATSAPP_PROVIDER } from "../_shared/inbox/whatsappSendMock.ts";
import { resolveMessagingWindow } from "../_shared/inbox/messagingWindow.ts";
import { assertWorkspaceActive, workspaceSuspendedBody } from "../_shared/workspaceStatus.ts";
import { describeTemplateEligibilityError, validateTemplateEligibility } from "../_shared/inbox/templateValidation.ts";
import { sanitizeIntegrationError } from "../_shared/integration-providers/metaGraphError.ts";
import { emitDomainEvent } from "../_shared/automations/emitDomainEvent.ts";

// deno-lint-ignore no-explicit-any
type AnySupabaseClient = any;

const VALID_ACTIONS = new Set(["assign", "return_to_ai", "resolve", "reopen", "reply", "reply_template", "mark_read", "add_note"]);

async function logActivity(sb: AnySupabaseClient, workspaceId: string, actorId: string, action: string, conversationId: string, metadata: Record<string, unknown> = {}) {
  await sb.from("workspace_activity_log").insert({ workspace_id: workspaceId, actor_user_id: actorId, action, target_type: "inbox_conversation", target_id: conversationId, metadata });
}

async function resolveCredential(sb: AnySupabaseClient, whatsappNumberId: string): Promise<WhatsAppSendCredential | null> {
  const { data: numberRow } = await sb.from("workspace_whatsapp_numbers").select("phone_number_id,integration_id").eq("id", whatsappNumberId).maybeSingle();
  if (!numberRow) return null;
  const { data: integration } = await sb.from("workspace_integrations").select("id,status").eq("id", numberRow.integration_id).maybeSingle();
  if (!integration || integration.status !== "connected") return null;
  const { data: token, error } = await sb.rpc("get_workspace_integration_secret", { p_integration_id: integration.id });
  if (error || !token) return null;
  return { token, phoneNumberId: numberRow.phone_number_id, apiVersion: Deno.env.get("INTEGRATIONS_META_GRAPH_API_VERSION")?.trim() || "" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": req.headers.get("origin") || "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  }
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json(req, { error: "Forbidden" }, 403);
  const callerSb = createCallerClient(token);
  const actorId = await getCallerUserId(callerSb);
  if (!actorId) return json(req, { error: "Forbidden" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }

  const workspaceId = body.workspace_id;
  const conversationId = body.conversation_id;
  const action = body.action;
  if (typeof workspaceId !== "string" || !workspaceId) return json(req, { error: "workspace_id is required" }, 400);
  if (typeof conversationId !== "string" || !conversationId) return json(req, { error: "conversation_id is required" }, 400);
  if (typeof action !== "string" || !VALID_ACTIONS.has(action)) return json(req, { error: "Unknown action" }, 400);

  const requiredPermission = action === "mark_read" ? "inbox.view" : "inbox.manage";
  if (!(await hasWorkspacePermission(callerSb, workspaceId, requiredPermission))) {
    return json(req, { error: "Forbidden" }, 403);
  }

  const serviceSb = createServiceClient();

  // Cross-workspace defense: the service role bypasses RLS for the writes
  // below, so conversation_id must be verified to actually belong to
  // workspace_id here - a caller with inbox.manage in THEIR OWN workspace
  // must never be able to act on a conversation_id borrowed from another
  // workspace by guessing/reusing an id.
  const { data: conversation } = await serviceSb
    .from("inbox_conversations")
    .select("id,workspace_id,whatsapp_number_id,wa_id,display_name,status,ai_enabled,assigned_staff_id,inbox_status,intake_missing_fields,intake_payload")
    .eq("id", conversationId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!conversation) return json(req, { error: "Conversation not found" }, 404);

  const { data: actorProfile } = await serviceSb.from("profiles").select("full_name").eq("id", actorId).maybeSingle();
  const actorName = actorProfile?.full_name?.trim() || "Staff";
  const nowIso = new Date().toISOString();

  if (action === "assign") {
    const staffId = body.staff_id;
    if (typeof staffId !== "string" || !staffId) return json(req, { error: "staff_id is required" }, 400);
    const { data: member } = await serviceSb.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("user_id", staffId).maybeSingle();
    if (!member) return json(req, { error: "That person is not a member of this workspace" }, 400);
    const { data: staffProfile } = await serviceSb.from("profiles").select("full_name").eq("id", staffId).maybeSingle();
    const wasAssigned = !!conversation.assigned_staff_id;
    const { error } = await serviceSb.from("inbox_conversations").update({
      status: "human_handoff",
      ai_enabled: false,
      human_handoff_requested_at: nowIso,
      assigned_staff_id: staffId,
      assigned_staff_name: staffProfile?.full_name?.trim() || "Staff",
      assigned_at: nowIso,
      assigned_by: actorId,
    }).eq("id", conversationId);
    if (error) return json(req, { error: "Unable to assign this conversation" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, wasAssigned ? "inbox_conversation_reassigned" : "inbox_conversation_assigned", conversationId, { staff_id: staffId });
    if (conversation.ai_enabled) {
      await emitDomainEvent(serviceSb, {
        workspaceId, eventType: "conversation.human_takeover", entityType: "inbox_conversation", entityId: conversationId,
        payload: { entity_id: conversationId, staff_id: staffId },
        dedupeKey: `conversation.human_takeover:${conversationId}:${nowIso}`,
      });
    }
    return json(req, { ok: true });
  }

  if (action === "return_to_ai") {
    const { error } = await serviceSb.from("inbox_conversations").update({
      status: "active",
      inbox_status: "new",
      ai_enabled: true,
      assigned_staff_id: null,
      assigned_staff_name: null,
      assigned_at: null,
      assigned_by: null,
      resolved_at: null,
      resolved_by: null,
    }).eq("id", conversationId);
    if (error) return json(req, { error: "Unable to return this conversation to AI" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, "inbox_conversation_returned_to_ai", conversationId, { previous_staff_id: conversation.assigned_staff_id });
    return json(req, { ok: true });
  }

  if (action === "resolve") {
    if (conversation.ai_enabled) return json(req, { error: "Take over the conversation before resolving it" }, 400);
    const { error } = await serviceSb.from("inbox_conversations").update({ inbox_status: "resolved", resolved_at: nowIso, resolved_by: actorId }).eq("id", conversationId);
    if (error) return json(req, { error: "Unable to resolve this conversation" }, 500);
    await serviceSb.from("inbox_alerts").update({ is_resolved: true, resolved_at: nowIso, resolved_by: actorId }).eq("conversation_id", conversationId).eq("is_resolved", false);
    await logActivity(serviceSb, workspaceId, actorId, "inbox_conversation_resolved", conversationId);
    return json(req, { ok: true });
  }

  if (action === "reopen") {
    const { error } = await serviceSb.from("inbox_conversations").update({
      status: "human_handoff",
      ai_enabled: false,
      inbox_status: conversation.assigned_staff_id ? "assigned" : "unassigned",
      resolved_at: null,
      resolved_by: null,
    }).eq("id", conversationId);
    if (error) return json(req, { error: "Unable to reopen this conversation" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, "inbox_conversation_reopened", conversationId);
    return json(req, { ok: true });
  }

  if (action === "mark_read") {
    await serviceSb.from("inbox_conversation_reads").upsert({ conversation_id: conversationId, staff_id: actorId, last_read_at: nowIso }, { onConflict: "conversation_id,staff_id" });
    await serviceSb.from("inbox_alerts").update({ is_resolved: true, resolved_at: nowIso, resolved_by: actorId }).eq("conversation_id", conversationId).eq("alert_type", "customer_reply").eq("is_resolved", false);
    return json(req, { ok: true });
  }

  if (action === "add_note") {
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!note || note.length > 2000) return json(req, { error: "Note must be between 1 and 2000 characters" }, 400);
    const mentioned = Array.isArray(body.mentioned_staff_ids) ? body.mentioned_staff_ids.filter((id): id is string => typeof id === "string") : [];
    const { error } = await serviceSb.from("inbox_internal_notes").insert({ workspace_id: workspaceId, conversation_id: conversationId, author_id: actorId, author_name: actorName, body: note, mentioned_staff_ids: mentioned });
    if (error) return json(req, { error: "Unable to save that note" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, "inbox_internal_note_added", conversationId, { mentioned_staff_ids: mentioned });
    return json(req, { ok: true });
  }

  const markHumanTakeover = async (wasAiEnabled: boolean) => {
    if (!wasAiEnabled) return;
    await emitDomainEvent(serviceSb, {
      workspaceId, eventType: "conversation.human_takeover", entityType: "inbox_conversation", entityId: conversationId,
      payload: { entity_id: conversationId, staff_id: actorId },
      dedupeKey: `conversation.human_takeover:${conversationId}:${nowIso}`,
    });
  };

  if (action === "reply") {
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 1000) return json(req, { error: "Message must be between 1 and 1000 characters" }, 400);

    // Launch-completion: a suspended/cancelled workspace cannot send a
    // provider-mutating message even via a direct call to this endpoint -
    // reads (assign/mark_read/add_note etc. above) are unaffected.
    const statusGate = await assertWorkspaceActive(serviceSb, workspaceId);
    if (!statusGate.allowed) return json(req, workspaceSuspendedBody(statusGate.status), 403);

    const cred = await resolveCredential(serviceSb, conversation.whatsapp_number_id);
    if (!cred) return json(req, { error: "WhatsApp is not connected for this workspace" }, 409);

    // Server-side policy gate BEFORE anything is saved/attempted (Phase
    // L-1: "a normal free-form send must NOT be attempted... do not
    // silently fail"). The browser never decides this - a direct call to
    // this endpoint hits the exact same check.
    const window = await resolveMessagingWindow(serviceSb, conversationId);
    if (window.state !== "open") {
      return json(req, {
        error: "24-hour messaging window closed. Send an approved template, or wait for the customer to message again.",
        code: "messaging_window_closed",
        window_state: window.state,
      }, 409);
    }

    const cleaned = cleanReply(message);
    const { data: pendingRow, error: pendingError } = await serviceSb.from("inbox_messages").insert({
      workspace_id: workspaceId,
      conversation_id: conversationId,
      direction: "outbound",
      sender_type: "staff",
      message_type: "text",
      content: cleaned,
      delivery_status: "sending",
      staff_sender_id: actorId,
      staff_sender_name: actorName,
    }).select("id").single();
    if (pendingError || !pendingRow) return json(req, { error: "Unable to save this reply" }, 500);

    const provider = isWhatsAppMockMode() ? MOCK_WHATSAPP_PROVIDER : REAL_WHATSAPP_PROVIDER;
    let providerMessageId: string | null = null;
    let deliveryStatus = "submitted";
    let warning: string | null = null;
    try {
      providerMessageId = await provider.sendText(cred, conversation.wa_id, cleaned);
    } catch (sendError) {
      deliveryStatus = "failed";
      warning = sanitizeIntegrationError(sendError).message;
    }

    await serviceSb.from("inbox_messages").update({ provider_message_id: providerMessageId, delivery_status: deliveryStatus }).eq("id", pendingRow.id);

    const wasAiEnabled = conversation.ai_enabled;
    const assignedToSelf = conversation.assigned_staff_id ? {} : { assigned_staff_id: actorId, assigned_staff_name: actorName, assigned_at: nowIso, assigned_by: actorId };
    await serviceSb.from("inbox_conversations").update({
      status: "human_handoff",
      ai_enabled: false,
      inbox_status: "waiting_client",
      last_staff_reply_at: nowIso,
      last_outbound_at: nowIso,
      ...assignedToSelf,
    }).eq("id", conversationId);

    await logActivity(serviceSb, workspaceId, actorId, "inbox_staff_reply_sent", conversationId, { delivery_status: deliveryStatus, provider_message_id: providerMessageId });
    await markHumanTakeover(wasAiEnabled);

    return json(req, { ok: true, delivery_status: deliveryStatus, warning });
  }

  // action === "reply_template" - the ONLY send path allowed outside the
  // 24-hour window (and always allowed inside it too - Meta doesn't
  // forbid a template send just because free-form is also available).
  const templateId = body.template_id;
  const rawParameters = Array.isArray(body.parameters) ? body.parameters : [];
  const parameters = rawParameters.filter((p): p is string => typeof p === "string");
  if (typeof templateId !== "string" || !templateId) return json(req, { error: "template_id is required" }, 400);
  if (parameters.length !== rawParameters.length) return json(req, { error: "All template parameters must be strings" }, 400);

  const templateStatusGate = await assertWorkspaceActive(serviceSb, workspaceId);
  if (!templateStatusGate.allowed) return json(req, workspaceSuspendedBody(templateStatusGate.status), 403);

  const cred = await resolveCredential(serviceSb, conversation.whatsapp_number_id);
  if (!cred) return json(req, { error: "WhatsApp is not connected for this workspace" }, 409);

  // Verify the template belongs to THIS workspace (never trust a
  // client-supplied id alone - the same cross-tenant defense every other
  // dispatcher action in this file already applies to conversation_id).
  const { data: template } = await serviceSb
    .from("whatsapp_message_templates")
    .select("id, name, language, provider_status, components")
    .eq("id", templateId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  const eligibility = validateTemplateEligibility(
    template ? { provider_status: template.provider_status, language: template.language, components: template.components } : null,
    parameters.length,
  );
  if (!eligibility.ok) {
    return json(req, { error: describeTemplateEligibilityError(eligibility.error), code: `template_${eligibility.error.code}` }, 422);
  }

  const bodyParameters: WhatsAppTemplateParameter[] = parameters.map((text) => ({ type: "text", text }));
  const provider = isWhatsAppMockMode() ? MOCK_WHATSAPP_PROVIDER : REAL_WHATSAPP_PROVIDER;
  const renderedContent = `[Template: ${template!.name}]` + (parameters.length ? ` ${parameters.join(", ")}` : "");

  let providerMessageId: string | null = null;
  let deliveryStatus = "submitted";
  let warning: string | null = null;
  try {
    providerMessageId = await provider.sendTemplate(cred, conversation.wa_id, { name: template!.name, language: template!.language, bodyParameters });
  } catch (sendError) {
    deliveryStatus = "failed";
    warning = sanitizeIntegrationError(sendError).message;
  }

  await serviceSb.from("inbox_messages").insert({
    workspace_id: workspaceId,
    conversation_id: conversationId,
    provider_message_id: providerMessageId,
    direction: "outbound",
    sender_type: "staff",
    message_type: "template",
    content: renderedContent,
    delivery_status: deliveryStatus,
    staff_sender_id: actorId,
    staff_sender_name: actorName,
  });

  const wasAiEnabledForTemplate = conversation.ai_enabled;
  const assignedToSelfForTemplate = conversation.assigned_staff_id ? {} : { assigned_staff_id: actorId, assigned_staff_name: actorName, assigned_at: nowIso, assigned_by: actorId };
  await serviceSb.from("inbox_conversations").update({
    status: "human_handoff",
    ai_enabled: false,
    inbox_status: "waiting_client",
    last_staff_reply_at: nowIso,
    last_outbound_at: nowIso,
    ...assignedToSelfForTemplate,
  }).eq("id", conversationId);

  await logActivity(serviceSb, workspaceId, actorId, "inbox_staff_template_sent", conversationId, { template_id: templateId, template_name: template!.name, delivery_status: deliveryStatus, provider_message_id: providerMessageId });
  await markHumanTakeover(wasAiEnabledForTemplate);

  return json(req, { ok: true, delivery_status: deliveryStatus, warning });
});

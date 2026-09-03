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
import { isBlockedWhatsAppMockSend, resolveWhatsAppSendMockMode, REAL_WHATSAPP_PROVIDER } from "../_shared/inbox/whatsappSendProvider.ts";
import { MOCK_WHATSAPP_PROVIDER } from "../_shared/inbox/whatsappSendMock.ts";
import { resolveMessagingWindow } from "../_shared/inbox/messagingWindow.ts";
import { assertWorkspaceActive, workspaceSuspendedBody } from "../_shared/workspaceStatus.ts";
import { describeTemplateEligibilityError, validateTemplateEligibility } from "../_shared/inbox/templateValidation.ts";
import { sanitizeIntegrationError } from "../_shared/integration-providers/metaGraphError.ts";
import { classifyOutboundFailure, initialFailurePatch, isAcceptedDelivery, type InitialFailurePatch } from "../_shared/inbox/outboundRetry.ts";
import {
  attemptTranscription,
  INBOX_VOICE_FEATURE,
  persistTranscriptionStatus,
  type VoiceMessageFacts,
} from "../_shared/inbox/voiceTranscription.ts";
import { decideInboxAiBudget, INBOX_AI_CAP_KEY, INBOX_AI_FEATURE, resolveInboxAiCap, utcDayStartIso, utcMonthStartIso } from "../_shared/inbox/inboxAiBudget.ts";
import { getPlatformTokenUsageSince, getWorkspaceFeaturesTokenUsageSince } from "../_shared/flowAi/usage.ts";
import { emitDomainEvent } from "../_shared/automations/emitDomainEvent.ts";
import { resolveActiveIntakeSchema } from "../_shared/inbox/intakeResolve.ts";
import { coerceFieldValue, evaluateIntake, readIntakePayload, resolveIntakeCompletion, writeIntakePayload } from "../_shared/inbox/intakeSchema.ts";

// deno-lint-ignore no-explicit-any
type AnySupabaseClient = any;

const VALID_ACTIONS = new Set(["assign", "return_to_ai", "resolve", "reopen", "reply", "reply_template", "mark_read", "add_note", "ask_info", "set_intake_answer", "link_customer", "unlink_customer", "set_priority", "set_handoff", "request_document", "add_tag", "retry_message", "retry_transcription"]);

const PRIORITY_LEVELS = new Set(["normal", "high", "urgent"]);

// Phase 8: when inbox-actions is called BY the automation worker (under the
// creator's impersonated token) it passes _automation_context. It only
// affects audit metadata + outbound send idempotency + the "don't force a
// human takeover for an automated template" behaviour - never the
// permission check (that already ran against the impersonated caller).
type AutomationCtx = { runId: string; automationId: string; actionIndex: number };
function parseAutomationContext(raw: unknown): AutomationCtx | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.runId !== "string" || typeof r.automationId !== "string" || typeof r.actionIndex !== "number") return null;
  return { runId: r.runId, automationId: r.automationId, actionIndex: r.actionIndex };
}

async function logActivity(sb: AnySupabaseClient, workspaceId: string, actorId: string, action: string, conversationId: string, metadata: Record<string, unknown> = {}) {
  await sb.from("workspace_activity_log").insert({ workspace_id: workspaceId, actor_user_id: actorId, action, target_type: "inbox_conversation", target_id: conversationId, metadata });
}

// Phase 5: a qualifying human action (staff reply / return-to-AI) clears an
// open handoff-SLA-overdue alert immediately - the minute-by-minute sweep
// would also catch it, this just makes the Needs Attention item disappear
// the moment the human acts. Writes one handoff_sla_resolved activity row
// only when an alert actually transitioned (never on every call).
async function resolveSlaAlert(sb: AnySupabaseClient, workspaceId: string, conversationId: string, actorId: string, nowIso: string) {
  const { data } = await sb.from("inbox_alerts")
    .update({ is_resolved: true, resolved_at: nowIso, resolved_by: actorId })
    .eq("conversation_id", conversationId).eq("alert_type", "handoff_sla_overdue").eq("is_resolved", false)
    .select("id");
  if (data && data.length > 0) {
    await sb.from("workspace_activity_log").insert({
      workspace_id: workspaceId, actor_user_id: actorId, action: "handoff_sla_resolved",
      target_type: "inbox_conversation", target_id: conversationId, metadata: { by: "staff_action" },
    });
  }
}

// Phase 7: an explicit Return to AI clears the "AI paused - usage limit
// reached" alert for this conversation. A plain staff reply does NOT (the
// conversation is still human-controlled and the pause still stands until
// someone deliberately hands it back). Conversation-resolve already clears
// every open alert, so it needs no special-casing here.
async function resolveAiLimitAlert(sb: AnySupabaseClient, conversationId: string, actorId: string, nowIso: string) {
  await sb.from("inbox_alerts")
    .update({ is_resolved: true, resolved_at: nowIso, resolved_by: actorId })
    .eq("conversation_id", conversationId).eq("alert_type", "ai_usage_limit_reached").eq("is_resolved", false);
}

type IntakeConversation = {
  id: string;
  workspace_id: string;
  whatsapp_number_id: string;
  lead_id: string | null;
  intake_schema_id: string | null;
  intake_completed_at: string | null;
  intake_payload: unknown;
};

// Phase 3: resolve the active schema for a conversation + evaluate it
// against the stored answers. Shared by ask_info and set_intake_answer.
async function loadIntakeContext(sb: AnySupabaseClient, conversation: IntakeConversation) {
  const { data: numberRow } = await sb.from("workspace_whatsapp_numbers").select("intake_schema_id").eq("id", conversation.whatsapp_number_id).maybeSingle();
  const schema = await resolveActiveIntakeSchema(sb, conversation.workspace_id, {
    conversationSchemaId: conversation.intake_schema_id,
    numberSchemaId: (numberRow?.intake_schema_id as string | null) ?? null,
  });
  const { fields } = readIntakePayload(conversation.intake_payload);
  const evaluation = schema ? evaluateIntake(schema, fields) : null;
  return { schema, fields, evaluation };
}

// Stamp intake_completed_at exactly once (race-safe conditional UPDATE) and
// emit conversation.intake_completed only if this call won the stamp. The
// dedupe_key (identical to the whatsapp-webhook path) is the second guard.
async function stampAndEmitIntakeCompletion(
  sb: AnySupabaseClient,
  conversation: IntakeConversation,
  evaluation: NonNullable<Awaited<ReturnType<typeof loadIntakeContext>>["evaluation"]>,
  schemaId: string,
) {
  const decision = resolveIntakeCompletion(conversation.id, conversation.intake_completed_at, evaluation);
  if (!decision.should_emit) return;
  const { data: stamped } = await sb
    .from("inbox_conversations")
    .update({ intake_completed_at: new Date().toISOString() })
    .eq("id", conversation.id)
    .is("intake_completed_at", null)
    .select("id")
    .maybeSingle();
  if (!stamped) return;
  await emitDomainEvent(sb, {
    workspaceId: conversation.workspace_id,
    eventType: "conversation.intake_completed",
    entityType: "inbox_conversation",
    entityId: conversation.id,
    payload: { entity_id: conversation.id, conversation_id: conversation.id, schema_id: schemaId, lead_id: conversation.lead_id ?? null },
    dedupeKey: decision.dedupe_key,
  });
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
    .select("id,workspace_id,whatsapp_number_id,wa_id,display_name,status,ai_enabled,assigned_staff_id,assigned_staff_name,inbox_status,priority_level,human_handoff_requested_at,intake_missing_fields,intake_payload,lead_id,intake_schema_id,intake_completed_at,customer_id")
    .eq("id", conversationId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!conversation) return json(req, { error: "Conversation not found" }, 404);

  const { data: actorProfile } = await serviceSb.from("profiles").select("full_name").eq("id", actorId).maybeSingle();
  const actorName = actorProfile?.full_name?.trim() || "Staff";
  const nowIso = new Date().toISOString();
  const automationCtx = parseAutomationContext(body._automation_context);
  const automationMeta = automationCtx ? { source: "automation", automation_id: automationCtx.automationId, automation_run_id: automationCtx.runId } : {};

  // --- Phase 8: set_priority ---------------------------------------------
  if (action === "set_priority") {
    const priority = typeof body.priority === "string" ? body.priority : "";
    if (!PRIORITY_LEVELS.has(priority)) return json(req, { error: "priority must be one of normal, high, urgent" }, 400);
    if (conversation.priority_level === priority) {
      return json(req, { ok: true, unchanged: true }); // idempotent no-op
    }
    const previous = conversation.priority_level;
    const { error } = await serviceSb.from("inbox_conversations").update({ priority_level: priority }).eq("id", conversationId);
    if (error) return json(req, { error: "Unable to set the conversation priority" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, "inbox_conversation_priority_set", conversationId, { ...automationMeta, previous_priority: previous, new_priority: priority });
    await emitDomainEvent(serviceSb, {
      workspaceId, eventType: "conversation.priority_changed", entityType: "inbox_conversation", entityId: conversationId,
      payload: { entity_id: conversationId, conversation_id: conversationId, previous_priority: previous, new_priority: priority },
      dedupeKey: `conversation.priority_changed:${conversationId}:${nowIso}`,
    });
    return json(req, { ok: true, previous_priority: previous, new_priority: priority });
  }

  // --- Phase 8: set_handoff (deliberate hand to a human) ---------------
  // Reuses the EXACT human-takeover transition every other path uses -
  // status/ai_enabled/human_handoff_requested_at + the open handoff alert +
  // the conversation.human_takeover event (the authoritative transition) -
  // so Phase-5 SLA starts naturally. Idempotent: a conversation already in
  // human handoff is left untouched (its SLA clock is not reset).
  if (action === "set_handoff") {
    if (conversation.status === "human_handoff" && conversation.ai_enabled === false) {
      return json(req, { ok: true, unchanged: true });
    }
    const wasAiEnabled = conversation.ai_enabled;
    const { error } = await serviceSb.from("inbox_conversations").update({
      status: "human_handoff",
      ai_enabled: false,
      ...(conversation.human_handoff_requested_at ? {} : { human_handoff_requested_at: nowIso }),
      inbox_status: conversation.assigned_staff_id ? "assigned" : "unassigned",
    }).eq("id", conversationId);
    if (error) return json(req, { error: "Unable to hand this conversation to a human" }, 500);
    await serviceSb.from("inbox_alerts").insert({
      workspace_id: workspaceId, conversation_id: conversationId, alert_type: "human_handoff", severity: "warning",
      title: "Conversation handed to a human", body: `${conversation.display_name || conversation.wa_id} needs a human reply.`,
      assigned_staff_id: conversation.assigned_staff_id,
    }).then(() => {}, () => {}); // 23505 = an open handoff alert already exists; fine
    await logActivity(serviceSb, workspaceId, actorId, "inbox_conversation_handoff_set", conversationId, automationMeta);
    if (wasAiEnabled) {
      await emitDomainEvent(serviceSb, {
        workspaceId, eventType: "conversation.human_takeover", entityType: "inbox_conversation", entityId: conversationId,
        payload: { entity_id: conversationId, conversation_id: conversationId, by: automationCtx ? "automation" : "staff" },
        dedupeKey: `conversation.human_takeover:${conversationId}:${nowIso}`,
      });
    }
    return json(req, { ok: true });
  }

  // --- Phase 8: add_tag ------------------------------------------------
  if (action === "add_tag") {
    const rawTag = typeof body.tag === "string" ? body.tag.trim() : "";
    if (!rawTag || rawTag.length > 60) return json(req, { error: "tag must be 1-60 characters" }, 400);
    const { error } = await serviceSb.from("inbox_conversation_tags").insert({
      workspace_id: workspaceId, conversation_id: conversationId, tag: rawTag,
      source: automationCtx ? "automation" : "staff", created_by: actorId,
    });
    // 23505 from the (workspace, conversation, lower(tag)) unique index just
    // means the tag is already there - a success, not an error.
    if (error && error.code !== "23505") return json(req, { error: "Unable to add this tag" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, "inbox_conversation_tag_added", conversationId, { ...automationMeta, tag: rawTag, already_present: error?.code === "23505" });
    return json(req, { ok: true, tag: rawTag, already_present: error?.code === "23505" });
  }

  // --- Phase 9: manual retry of a failed / dead-lettered outbound -------
  // Re-runs EVERY outbound safety gate against CURRENT state, sends once
  // through the same provider seam, and records the outcome on the SAME
  // logical message row via apply_whatsapp_retry_outcome. Dead-letter is
  // cleared only because a fresh attempt is actually being made.
  if (action === "retry_message") {
    const messageId = typeof body.message_id === "string" ? body.message_id : "";
    if (!messageId) return json(req, { error: "message_id is required" }, 400);
    const { data: msg } = await serviceSb.from("inbox_messages")
      .select("id, workspace_id, conversation_id, direction, message_type, content, delivery_status, provider_message_id, retry_claimed_at, dead_lettered_at, template_id, template_parameters")
      .eq("id", messageId).eq("workspace_id", workspaceId).eq("conversation_id", conversationId).maybeSingle();
    if (!msg || msg.direction !== "outbound") return json(req, { error: "Message not found" }, 404);
    if (isAcceptedDelivery(msg.delivery_status) || msg.provider_message_id) {
      return json(req, { error: "This message has already been accepted for delivery.", code: "already_accepted" }, 409);
    }
    if (msg.retry_claimed_at && new Date(msg.retry_claimed_at).getTime() > Date.now() - 5 * 60_000) {
      return json(req, { error: "A retry for this message is already in progress.", code: "retry_in_progress" }, 409);
    }

    await logActivity(serviceSb, workspaceId, actorId, "whatsapp_manual_retry_requested", conversationId, { message_id: messageId });
    // claim + clear dead-letter so apply_whatsapp_retry_outcome will act
    await serviceSb.from("inbox_messages").update({ retry_claimed_at: nowIso, dead_lettered_at: null, dead_letter_reason: null }).eq("id", messageId);

    const gate = await assertWorkspaceActive(serviceSb, workspaceId);
    if (!gate.allowed) {
      await serviceSb.rpc("apply_whatsapp_retry_outcome", { p_message_id: messageId, p_outcome: "policy_blocked", p_failure_code: "workspace_suspended", p_failure_category: "policy_blocked", p_source: "manual_retry", p_actor: actorId });
      return json(req, workspaceSuspendedBody(gate.status), 403);
    }
    const retryCred = await resolveCredential(serviceSb, conversation.whatsapp_number_id);
    if (!retryCred) {
      await serviceSb.rpc("apply_whatsapp_retry_outcome", { p_message_id: messageId, p_outcome: "policy_blocked", p_failure_code: "credential_unavailable", p_failure_category: "policy_blocked", p_source: "manual_retry", p_actor: actorId });
      return json(req, { error: "WhatsApp is not connected for this workspace", code: "credential_unavailable" }, 409);
    }

    const isTemplate = msg.message_type === "template";
    let tplName: string | null = null;
    let tplLang: string | null = null;
    if (isTemplate) {
      const { data: tpl } = await serviceSb.from("whatsapp_message_templates")
        .select("name, language, provider_status, components").eq("id", msg.template_id).eq("workspace_id", workspaceId).maybeSingle();
      const elig = validateTemplateEligibility(tpl ? { provider_status: tpl.provider_status, language: tpl.language, components: tpl.components } : null, (msg.template_parameters ?? []).length);
      if (!elig.ok) {
        await serviceSb.rpc("apply_whatsapp_retry_outcome", { p_message_id: messageId, p_outcome: "policy_blocked", p_failure_code: `template_${elig.error.code}`, p_failure_category: "policy_blocked", p_source: "manual_retry", p_actor: actorId });
        return json(req, { error: describeTemplateEligibilityError(elig.error), code: `template_${elig.error.code}` }, 422);
      }
      tplName = tpl!.name; tplLang = tpl!.language;
    } else {
      const window = await resolveMessagingWindow(serviceSb, conversationId);
      if (window.state !== "open") {
        await serviceSb.rpc("apply_whatsapp_retry_outcome", { p_message_id: messageId, p_outcome: "policy_blocked", p_failure_code: "messaging_window_closed", p_failure_category: "policy_blocked", p_source: "manual_retry", p_actor: actorId });
        return json(req, { error: "The 24-hour messaging window has closed. Send an approved template instead.", code: "messaging_window_closed" }, 409);
      }
    }

    const provider = resolveWhatsAppSendMockMode(req) ? MOCK_WHATSAPP_PROVIDER : REAL_WHATSAPP_PROVIDER;
    let retryWamid: string | null = null;
    let retryOutcome: "success" | "retryable" | "permanent" | "policy_blocked" = "success";
    let retryCode: string | null = null;
    let retryCat: string | null = null;
    try {
      retryWamid = isTemplate
        ? await provider.sendTemplate(retryCred, conversation.wa_id, { name: tplName!, language: tplLang!, bodyParameters: (msg.template_parameters ?? []).map((t: string) => ({ type: "text", text: t })) })
        : await provider.sendText(retryCred, conversation.wa_id, cleanReply(msg.content ?? ""));
    } catch (sendError) {
      const c = classifyOutboundFailure(sendError);
      retryOutcome = c.failureClass; retryCode = c.code; retryCat = c.category;
    }
    const { data: outcome } = await serviceSb.rpc("apply_whatsapp_retry_outcome", {
      p_message_id: messageId, p_outcome: retryOutcome, p_failure_code: retryCode, p_failure_category: retryCat,
      p_provider_message_id: retryWamid, p_source: "manual_retry", p_actor: actorId,
    });
    return json(req, { ok: true, outcome });
  }

  // --- Phase 10: manual retry of a customer voice-note transcription ----
  // For a stored inbound voice/audio message whose transcription failed or
  // was skipped for cost. Re-uses the SAME message row and the SAME stored
  // audio - never a new message, never a second logical send. Respects the
  // workspace opt-in intent implicitly (a transcript already being asked
  // for), the workspace status, and the shared Inbox AI monthly budget.
  if (action === "retry_transcription") {
    const messageId = typeof body.message_id === "string" ? body.message_id : "";
    if (!messageId) return json(req, { error: "message_id is required" }, 400);
    const { data: msg } = await serviceSb.from("inbox_messages")
      .select("id, direction, message_type, media_mime_type, media_size_bytes, media_storage_path, transcription_status")
      .eq("id", messageId).eq("workspace_id", workspaceId).eq("conversation_id", conversationId).maybeSingle();
    if (!msg || msg.direction !== "inbound" || (msg.message_type !== "voice" && msg.message_type !== "audio") || !msg.media_storage_path) {
      return json(req, { error: "Voice note not found" }, 404);
    }
    if (msg.transcription_status === "processed") {
      return json(req, { error: "This voice note is already transcribed.", code: "already_transcribed" }, 409);
    }
    if (msg.transcription_status === "pending") {
      return json(req, { error: "A transcription for this voice note is already in progress.", code: "transcription_in_progress" }, 409);
    }

    const transcribeGate = await assertWorkspaceActive(serviceSb, workspaceId);
    if (!transcribeGate.allowed) return json(req, workspaceSuspendedBody(transcribeGate.status), 403);

    const transcribeKey = Deno.env.get("OPENAI_API_KEY")?.trim();
    const transcribeModel = Deno.env.get("OPENAI_TRANSCRIBE_MODEL")?.trim() || "gpt-4o-mini-transcribe";
    if (!transcribeKey) return json(req, { error: "Voice transcription is not configured for this deployment.", code: "transcription_unavailable" }, 503);

    // Shared Inbox AI monthly budget (Phase 7 + 10): transcription never
    // gets a second, uncapped allowance.
    const { data: billingRow } = await serviceSb.from("workspace_billing").select("limits").eq("workspace_id", workspaceId).maybeSingle();
    const cap = resolveInboxAiCap((billingRow?.limits as Record<string, unknown> | null)?.[INBOX_AI_CAP_KEY], Deno.env.get("FLOW_AI_DEFAULT_WORKSPACE_MONTHLY_TOKEN_LIMIT"));
    const usedTokens = await getWorkspaceFeaturesTokenUsageSince(serviceSb, workspaceId, [INBOX_AI_FEATURE, INBOX_VOICE_FEATURE], utcMonthStartIso(new Date()));
    const ceilRaw = Number(Deno.env.get("FLOW_AI_PLATFORM_DAILY_TOKEN_CEILING")?.trim());
    const ceil = Number.isFinite(ceilRaw) && ceilRaw > 0 ? ceilRaw : null;
    const platUsed = ceil !== null ? await getPlatformTokenUsageSince(serviceSb, utcDayStartIso(new Date())) : null;
    const budget = decideInboxAiBudget({ workspaceUsed: usedTokens, workspaceCap: cap, platformUsed: platUsed, platformCeiling: ceil });
    if (!budget.allowed) {
      await persistTranscriptionStatus(serviceSb, messageId, "skipped_quota", null);
      return json(req, { error: "This workspace has reached its monthly Inbox AI usage limit.", code: "quota_exhausted" }, 409);
    }

    await serviceSb.from("inbox_messages").update({ transcription_status: "pending" }).eq("id", messageId);
    const { data: blob, error: dlError } = await serviceSb.storage.from("inbox-media").download(msg.media_storage_path);
    if (dlError || !blob) {
      await persistTranscriptionStatus(serviceSb, messageId, "failed", null);
      return json(req, { error: "Could not read the stored audio for this voice note.", code: "audio_unavailable" }, 502);
    }
    const facts: VoiceMessageFacts = {
      direction: "inbound", sender_type: "customer", message_type: msg.message_type,
      media_mime_type: msg.media_mime_type, media_size_bytes: msg.media_size_bytes, media_storage_path: msg.media_storage_path,
    };
    const outcome = await attemptTranscription(serviceSb, {
      messageId, workspaceId, facts, audioBytes: new Uint8Array(await blob.arrayBuffer()),
      cred: { apiKey: transcribeKey, model: transcribeModel }, source: "manual_retry",
    });
    await logActivity(serviceSb, workspaceId, actorId, "whatsapp_transcription_retry_requested", conversationId, { message_id: messageId, status: outcome.status });
    return json(req, { ok: true, status: outcome.status });
  }

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
    await resolveSlaAlert(serviceSb, workspaceId, conversationId, actorId, nowIso);
    await resolveAiLimitAlert(serviceSb, conversationId, actorId, nowIso);
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

  // Phase 3: Real Ask Info. Two-step - a preview call (confirm falsy)
  // returns the EXACT question that would be sent and never sends
  // anything; a confirm:true call sends it through the same safe path as a
  // staff reply (workspace-active gate, connected credential, 24-hour
  // window - a closed window returns 409 so the caller uses the approved
  // template flow). Deliberately does NOT flip ai_enabled / force human
  // takeover: Ask Info nudges the AI-owned intake flow along.
  if (action === "ask_info") {
    const intakeConversation = conversation as unknown as IntakeConversation;
    const { schema, evaluation } = await loadIntakeContext(serviceSb, intakeConversation);
    if (!schema || !evaluation) {
      return json(req, { ok: true, has_schema: false, next_question: null, complete: false });
    }
    if (!evaluation.next_field) {
      return json(req, { ok: true, has_schema: true, next_question: null, complete: evaluation.complete });
    }

    const nextQuestion = evaluation.next_field.question_text;
    const fieldKey = evaluation.next_field.key;
    const fieldLabel = evaluation.next_field.label;
    const confirm = body.confirm === true;

    const window = await resolveMessagingWindow(serviceSb, conversationId);
    if (!confirm) {
      return json(req, {
        ok: true,
        has_schema: true,
        next_question: nextQuestion,
        field_key: fieldKey,
        field_label: fieldLabel,
        window_state: window.state,
        requires_template: window.state !== "open",
        complete: evaluation.complete,
      });
    }

    const statusGate = await assertWorkspaceActive(serviceSb, workspaceId);
    if (!statusGate.allowed) return json(req, workspaceSuspendedBody(statusGate.status), 403);

    const cred = await resolveCredential(serviceSb, conversation.whatsapp_number_id);
    if (!cred) return json(req, { error: "WhatsApp is not connected for this workspace" }, 409);

    if (window.state !== "open") {
      return json(req, {
        error: "24-hour messaging window closed. Send an approved template, or wait for the customer to message again.",
        code: "messaging_window_closed",
        window_state: window.state,
      }, 409);
    }

    const cleaned = cleanReply(nextQuestion);
    const { data: pendingRow, error: pendingError } = await serviceSb.from("inbox_messages").insert({
      workspace_id: workspaceId,
      conversation_id: conversationId,
      direction: "outbound",
      sender_type: "ai",
      message_type: "text",
      content: cleaned,
      delivery_status: "sending",
    }).select("id").single();
    if (pendingError || !pendingRow) return json(req, { error: "Unable to save this question" }, 500);

    if (isBlockedWhatsAppMockSend(req)) console.warn("inbox-actions: mock-mode flag is on but caller is not the test harness - sending for real");
    const provider = resolveWhatsAppSendMockMode(req) ? MOCK_WHATSAPP_PROVIDER : REAL_WHATSAPP_PROVIDER;
    let providerMessageId: string | null = null;
    let deliveryStatus = "submitted";
    let warning: string | null = null;
    let failPatch: InitialFailurePatch | null = null;
    try {
      providerMessageId = await provider.sendText(cred, conversation.wa_id, cleaned);
    } catch (sendError) {
      failPatch = initialFailurePatch(sendError);
      deliveryStatus = "failed";
      warning = sanitizeIntegrationError(sendError).message;
    }
    // Phase 9: a transient failure schedules a retry on this same row; a
    // permanent / policy failure dead-letters it now. Ask Info retry re-sends
    // this exact question - it never regenerates or advances intake.
    await serviceSb.from("inbox_messages").update({ provider_message_id: providerMessageId, ...(failPatch ?? { delivery_status: deliveryStatus }) }).eq("id", pendingRow.id);
    await serviceSb.from("inbox_conversations").update({ last_outbound_at: nowIso }).eq("id", conversationId);
    await logActivity(serviceSb, workspaceId, actorId, "inbox_ask_info_sent", conversationId, { field_key: fieldKey, delivery_status: deliveryStatus });

    return json(req, { ok: true, delivery_status: deliveryStatus, warning, next_question: nextQuestion, field_key: fieldKey });
  }

  // Phase 3: staff manually sets / corrects a structured answer (PDF: "Edit/
  // correct answer where permissions allow"). Validates against the field's
  // type, writes the canonical { schema_id, fields } payload, recomputes
  // the missing set, and drives the same one-shot
  // conversation.intake_completed transition the webhook does.
  if (action === "set_intake_answer") {
    const fieldKey = typeof body.field_key === "string" ? body.field_key.trim() : "";
    if (!fieldKey) return json(req, { error: "field_key is required" }, 400);
    const rawValue = "value" in body ? body.value : null;

    const intakeConversation = conversation as unknown as IntakeConversation;
    const { schema, fields } = await loadIntakeContext(serviceSb, intakeConversation);
    if (!schema) return json(req, { error: "This workspace has no active intake schema" }, 409);
    const fieldDef = schema.fields.find((f) => f.key === fieldKey);
    if (!fieldDef) return json(req, { error: "That field is not in the active intake schema" }, 400);

    const nextFields = { ...fields };
    const clearing = rawValue === null || rawValue === undefined || rawValue === "";
    if (clearing) {
      delete nextFields[fieldKey];
    } else {
      const coerced = coerceFieldValue(fieldDef, rawValue);
      if (coerced.status !== "ok") {
        return json(req, { error: "That value isn't valid for this field", code: "invalid_field_value", reason: coerced.status === "invalid" ? coerced.reason : "empty" }, 400);
      }
      nextFields[fieldKey] = coerced.value;
    }

    const evaluation = evaluateIntake(schema, nextFields);
    const { error: updateError } = await serviceSb.from("inbox_conversations").update({
      intake_payload: writeIntakePayload(schema.id, nextFields),
      intake_missing_fields: evaluation.missing_required,
      intake_schema_id: schema.id,
    }).eq("id", conversationId);
    if (updateError) return json(req, { error: "Unable to save that answer" }, 500);

    await stampAndEmitIntakeCompletion(serviceSb, { ...intakeConversation, intake_schema_id: schema.id }, evaluation, schema.id);
    await logActivity(serviceSb, workspaceId, actorId, "inbox_intake_answer_set", conversationId, { field_key: fieldKey, cleared: clearing });

    return json(req, {
      ok: true,
      evaluation: {
        collected: evaluation.collected,
        missing_required: evaluation.missing_required,
        invalid: evaluation.invalid,
        required_total: evaluation.required_total,
        required_collected: evaluation.required_collected,
        complete: evaluation.complete,
        next_question: evaluation.next_question,
      },
    });
  }

  // Phase 4: conversation <-> customer link. Explicit staff action
  // (inbox.manage). Cross-workspace customer_id is rejected here AND by the
  // inbox_conversations validate trigger. Linking additively backfills the
  // customer_id onto this conversation's attribution touchpoints (NULL-only,
  // never rewrites existing evidence); unlink never touches attribution.
  if (action === "link_customer") {
    const customerId = typeof body.customer_id === "string" ? body.customer_id : "";
    if (!customerId) return json(req, { error: "customer_id is required" }, 400);

    const { data: customer } = await serviceSb
      .from("customers")
      .select("id, name, customer_since, phone, email, company_name, status")
      .eq("id", customerId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!customer) return json(req, { error: "Customer not found" }, 404);

    const previous = (conversation as { customer_id: string | null }).customer_id ?? null;
    if (previous && previous !== customerId && body.change !== true) {
      return json(req, { error: "This conversation is already linked to a customer. Pass change:true to move it.", code: "already_linked" }, 409);
    }
    if (previous === customerId) return json(req, { ok: true, customer, unchanged: true });

    const { error: updErr } = await serviceSb.from("inbox_conversations").update({ customer_id: customerId }).eq("id", conversationId);
    if (updErr) return json(req, { error: "Unable to link this customer" }, 500);

    // Additive, NULL-only - identical contract to leads-actions
    // backfillAttribution. Existing customer_id evidence is preserved.
    await serviceSb.from("attribution_events").update({ customer_id: customerId }).eq("conversation_id", conversationId).is("customer_id", null);
    await logActivity(serviceSb, workspaceId, actorId, "inbox_conversation_customer_linked", conversationId, { customer_id: customerId, changed_from: previous });

    return json(req, { ok: true, customer });
  }

  if (action === "unlink_customer") {
    const previous = (conversation as { customer_id: string | null }).customer_id ?? null;
    if (!previous) return json(req, { ok: true, unchanged: true });
    const { error: updErr } = await serviceSb.from("inbox_conversations").update({ customer_id: null }).eq("id", conversationId);
    if (updErr) return json(req, { error: "Unable to unlink this customer" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, "inbox_conversation_customer_unlinked", conversationId, { previous_customer_id: previous });
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

    if (isBlockedWhatsAppMockSend(req)) console.warn("inbox-actions: mock-mode flag is on but caller is not the test harness - sending for real");
    const provider = resolveWhatsAppSendMockMode(req) ? MOCK_WHATSAPP_PROVIDER : REAL_WHATSAPP_PROVIDER;
    let providerMessageId: string | null = null;
    let deliveryStatus = "submitted";
    let warning: string | null = null;
    let failPatch: InitialFailurePatch | null = null;
    try {
      providerMessageId = await provider.sendText(cred, conversation.wa_id, cleaned);
    } catch (sendError) {
      failPatch = initialFailurePatch(sendError);
      deliveryStatus = "failed";
      warning = sanitizeIntegrationError(sendError).message;
    }

    // Phase 9: transient failure -> retry scheduled on this row; permanent /
    // policy failure -> dead-lettered now. The retry re-runs the free-form
    // window gate, so a retry after the window closes will NOT free-form send.
    await serviceSb.from("inbox_messages").update({ provider_message_id: providerMessageId, ...(failPatch ?? { delivery_status: deliveryStatus }) }).eq("id", pendingRow.id);

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
    await resolveSlaAlert(serviceSb, workspaceId, conversationId, actorId, nowIso);
    await markHumanTakeover(wasAiEnabled);

    return json(req, { ok: true, delivery_status: deliveryStatus, warning });
  }

  // action === "reply_template" (staff) or "request_document" (Phase 8) -
  // the ONLY send path allowed outside the 24-hour window (and always
  // allowed inside it too - Meta doesn't forbid a template send just
  // because free-form is also available). request_document is a thin
  // wrapper: an optional document_field_key that must exist in the
  // conversation's pinned intake schema, then the exact same safe send.
  const templateId = body.template_id;
  const rawParameters = Array.isArray(body.parameters) ? body.parameters : [];
  const parameters = rawParameters.filter((p): p is string => typeof p === "string");
  if (typeof templateId !== "string" || !templateId) return json(req, { error: "template_id is required" }, 400);
  if (parameters.length !== rawParameters.length) return json(req, { error: "All template parameters must be strings" }, 400);

  // Phase 8 request_document: if a field_key is given it must be a real
  // key in THIS conversation's pinned intake schema (never a free-form /
  // cross-workspace name).
  if (action === "request_document" && typeof body.document_field_key === "string" && body.document_field_key) {
    const fieldKey = body.document_field_key;
    const schema = await resolveActiveIntakeSchema(serviceSb, workspaceId, {
      conversationSchemaId: (conversation.intake_schema_id as string | null) ?? null,
      numberSchemaId: null,
    });
    if (!schema || !schema.fields.some((f) => f.key === fieldKey && f.is_active !== false)) {
      return json(req, { error: `"${fieldKey}" is not a field in this conversation's intake schema`, code: "unknown_intake_field" }, 422);
    }
  }

  // Phase 8 send idempotency: a retried automation run re-executes its
  // actions from the top - if THIS run+action already produced an outbound
  // row, do not send again.
  if (automationCtx) {
    const { data: already } = await serviceSb.from("inbox_messages")
      .select("id, delivery_status")
      .eq("automation_run_id", automationCtx.runId)
      .eq("automation_action_index", automationCtx.actionIndex)
      .maybeSingle();
    if (already) return json(req, { ok: true, delivery_status: already.delivery_status, deduped: true });
  }

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
  if (isBlockedWhatsAppMockSend(req)) console.warn("inbox-actions: mock-mode flag is on but caller is not the test harness - sending template for real");
  const provider = resolveWhatsAppSendMockMode(req) ? MOCK_WHATSAPP_PROVIDER : REAL_WHATSAPP_PROVIDER;
  const renderedContent = `[Template: ${template!.name}]` + (parameters.length ? ` ${parameters.join(", ")}` : "");

  let providerMessageId: string | null = null;
  let deliveryStatus = "submitted";
  let warning: string | null = null;
  let failPatch: InitialFailurePatch | null = null;
  try {
    providerMessageId = await provider.sendTemplate(cred, conversation.wa_id, { name: template!.name, language: template!.language, bodyParameters });
  } catch (sendError) {
    failPatch = initialFailurePatch(sendError);
    deliveryStatus = "failed";
    warning = sanitizeIntegrationError(sendError).message;
  }

  const { error: msgInsertError } = await serviceSb.from("inbox_messages").insert({
    workspace_id: workspaceId,
    conversation_id: conversationId,
    provider_message_id: providerMessageId,
    direction: "outbound",
    // An automation-sent template is a system message, not a staff reply -
    // it does not stamp a staff sender or (below) force a human takeover.
    sender_type: automationCtx ? "system" : "staff",
    message_type: "template",
    content: renderedContent,
    delivery_status: deliveryStatus,
    staff_sender_id: automationCtx ? null : actorId,
    staff_sender_name: automationCtx ? null : actorName,
    automation_run_id: automationCtx?.runId ?? null,
    automation_action_index: automationCtx?.actionIndex ?? null,
    // Phase 9: keep the authoritative template id + params so a retry
    // re-fetches the template, re-checks APPROVED, and re-sends the SAME
    // parameters - never a stale payload, never a silent template switch.
    template_id: templateId,
    template_parameters: parameters,
    ...(failPatch ?? {}),
  });
  if (msgInsertError) {
    // A 23505 here means a concurrent request for the SAME (run, action)
    // already recorded the outbound row - the send just happened twice at
    // the provider, which is the known bounded risk this index minimises,
    // not a client-facing failure. Any other insert error IS a failure.
    if (msgInsertError.code !== "23505") return json(req, { error: "The message was sent but could not be recorded", code: "ledger_write_failed" }, 500);
  }

  if (automationCtx) {
    // Proactive automated outreach - keep the AI running, don't assign,
    // don't force human_handoff. Just record the outbound timestamp.
    await serviceSb.from("inbox_conversations").update({ last_outbound_at: nowIso }).eq("id", conversationId);
    await logActivity(serviceSb, workspaceId, actorId, action === "request_document" ? "inbox_automation_document_requested" : "inbox_automation_template_sent", conversationId, {
      ...automationMeta, template_id: templateId, template_name: template!.name, delivery_status: deliveryStatus,
      ...(action === "request_document" && typeof body.document_field_key === "string" ? { field_key: body.document_field_key } : {}),
    });
    return json(req, { ok: true, delivery_status: deliveryStatus, warning });
  }

  // Staff template send - unchanged: this IS a human takeover.
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
  await resolveSlaAlert(serviceSb, workspaceId, conversationId, actorId, nowIso);
  await markHumanTakeover(wasAiEnabledForTemplate);

  return json(req, { ok: true, delivery_status: deliveryStatus, warning });
});

// WhatsApp webhook receiver - routing (Phase C) PLUS full message
// processing (Phase D). Adapted from Acapolite's whatsapp-agent/index.ts
// main handler - same overall flow (dedup -> upsert conversation -> store
// media -> skip if human-controlled/AI-disabled -> fast-path checks -> AI
// call -> safety guardrails -> send reply), generalized: no tax/SARS
// content, no service_request bridge, and every step resolves its
// workspace/credential from StabiFlow's OWN per-workspace
// workspace_whatsapp_numbers/workspace_integrations + Vault, never a
// global WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID env var.
//
// Hit directly by Meta's webhook infrastructure, not by StabiFlow's
// frontend - deployed with verify_jwt=false (see supabase/config.toml).
// Every inbound POST is signature-verified before its JSON is even parsed;
// routing/workspace resolution is ALWAYS derived from the signature-verified
// phone_number_id, never a caller-supplied workspace id (instruction: "do
// not trust a workspace ID supplied only by the browser or webhook
// caller").
import { verifyMetaWebhookSignature, verifyWebhookChallenge } from "../_shared/integration-providers/webhookSignature.ts";
import { parseWhatsAppWebhookEvents } from "../_shared/integration-providers/whatsappWebhookPayload.ts";
import { createServiceClient, envVar } from "../_shared/contentAuth.ts";
import { applyStatusUpdate, incomingStatuses } from "../_shared/inbox/whatsappStatus.ts";
import { normalizePhone, parseInboundMessageEvents, type InboundMessageEvent } from "../_shared/inbox/webhookMessageParser.ts";
import { cleanReply, containsFalseActionClaim, containsInventedPersonalIdentity, isSimpleGreeting, requestsHumanHandoff } from "../_shared/inbox/replyGuardrails.ts";
import { generateAIReply, generateStructuredReply, mergeExtracted, missingFields, type ConversationHistoryMessage } from "../_shared/inbox/aiReplyEngine.ts";
import { evaluateIntake, mergeExtractedFields, readIntakePayload, resolveIntakeCompletion, writeIntakePayload } from "../_shared/inbox/intakeSchema.ts";
import { resolveActiveIntakeSchema } from "../_shared/inbox/intakeResolve.ts";
import { ALLOWED_INBOUND_MEDIA_MIME_TYPES, downloadWhatsAppMedia, type WhatsAppSendCredential } from "../_shared/inbox/whatsappSend.ts";
import { REAL_WHATSAPP_PROVIDER } from "../_shared/inbox/whatsappSendProvider.ts";
import { resolveMessagingWindow } from "../_shared/inbox/messagingWindow.ts";
import { assertWorkspaceActive } from "../_shared/workspaceStatus.ts";
import { sanitizeIntegrationError } from "../_shared/integration-providers/metaGraphError.ts";
import { recordConversationTouchpoint } from "../_shared/attribution.ts";
import { emitDomainEvent } from "../_shared/automations/emitDomainEvent.ts";

// deno-lint-ignore no-explicit-any
type AnySupabaseClient = any;

function text(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

type NumberRow = { id: string; workspace_id: string; integration_id: string; phone_number_id: string; intake_schema_id: string | null };

async function resolveCredential(sb: AnySupabaseClient, numberRow: NumberRow): Promise<WhatsAppSendCredential | null> {
  const { data: integration } = await sb.from("workspace_integrations").select("id,status").eq("id", numberRow.integration_id).maybeSingle();
  if (!integration || integration.status !== "connected") return null;
  const { data: token, error } = await sb.rpc("get_workspace_integration_secret", { p_integration_id: integration.id });
  if (error || !token) return null;
  return { token, phoneNumberId: numberRow.phone_number_id, apiVersion: envVar("INTEGRATIONS_META_GRAPH_API_VERSION") };
}

// The ONE place whatsapp-webhook attempts a free-form send - every AI/
// system auto-reply in this file funnels through here, so the messaging-
// window gate only needs to live in one place to cover all of them
// (Phase L-1: "centralize outbound policy"). In today's call graph this
// check is structurally always "open" (storeOutbound only ever runs in
// direct response to the customer message that JUST reopened the window -
// see messagingWindow.ts's header comment), but it stays here anyway as
// the deterministic, future-safe seam: no path through this function can
// ever send free-form text without going through the same policy a
// delayed retry or a future trigger would also have to pass.
//
// When the window is NOT open, this deliberately does NOT send anything
// and does NOT insert a fake "sent" message - it hands the conversation to
// a human (the only thing that CAN act here: neither a free-form message
// nor an explanatory system message is deliverable outside the window)
// and records why, visibly, as an internal note - never a silent no-op.
async function storeOutbound(sb: AnySupabaseClient, cred: WhatsAppSendCredential, workspaceId: string, conversationId: string, waId: string, body: string, senderType: "ai" | "system" | "staff" = "ai") {
  const cleaned = cleanReply(body);
  if (!cleaned) return;

  // Launch-completion: a suspended/cancelled workspace's AI auto-reply
  // path is blocked exactly like a closed messaging window - hand off to
  // a human, record what would have been said with a distinct
  // never-sent status, never a fabricated success. Checked before the
  // window (a suspended workspace shouldn't burn a webhook round-trip
  // computing window state it won't act on either way).
  const statusGate = await assertWorkspaceActive(sb, workspaceId);
  if (!statusGate.allowed) {
    await sb.from("inbox_conversations").update({ status: "human_handoff", ai_enabled: false, human_handoff_requested_at: new Date().toISOString() }).eq("id", conversationId);
    await sb.from("inbox_messages").insert({
      workspace_id: workspaceId,
      conversation_id: conversationId,
      provider_message_id: null,
      direction: "outbound",
      sender_type: senderType,
      message_type: "text",
      content: cleaned,
      delivery_status: "blocked_workspace_suspended",
    });
    return;
  }

  const window = await resolveMessagingWindow(sb, conversationId);
  if (window.state !== "open") {
    // Hand off to a human (nothing - not even an explanatory system
    // message - is deliverable outside the window), and record what the
    // AI would have said directly in the message thread with a status
    // that unambiguously means "never sent" - visible exactly where staff
    // are already looking, never a silent drop.
    await sb.from("inbox_conversations").update({ status: "human_handoff", ai_enabled: false, human_handoff_requested_at: new Date().toISOString() }).eq("id", conversationId);
    await sb.from("inbox_messages").insert({
      workspace_id: workspaceId,
      conversation_id: conversationId,
      provider_message_id: null,
      direction: "outbound",
      sender_type: senderType,
      message_type: "text",
      content: cleaned,
      delivery_status: "blocked_window_closed",
    });
    return;
  }

  // W1 hardening: the webhook is only ever reached by signature-verified
  // Meta traffic - there is no legitimate caller that should see a faked
  // send here, so this path always uses the REAL provider regardless of
  // INTEGRATIONS_META_MOCK_MODE. The mock send seam exists solely for the
  // harness-gated inbox-actions tests (whatsappSendProvider.ts).
  const provider = REAL_WHATSAPP_PROVIDER;
  let providerMessageId: string | null = null;
  let deliveryStatus = "submitted";
  try {
    providerMessageId = await provider.sendText(cred, waId, cleaned);
  } catch (error) {
    console.error("whatsapp-webhook: send failed", sanitizeIntegrationError(error).message);
    deliveryStatus = "failed";
  }
  await sb.from("inbox_messages").insert({
    workspace_id: workspaceId,
    conversation_id: conversationId,
    provider_message_id: providerMessageId,
    direction: "outbound",
    sender_type: senderType,
    message_type: "text",
    content: cleaned,
    delivery_status: deliveryStatus,
  });
  await sb.from("inbox_conversations").update({ last_outbound_at: new Date().toISOString() }).eq("id", conversationId);
}

async function processMessageEvent(sb: AnySupabaseClient, event: InboundMessageEvent) {
  const { data: numberRow } = await sb
    .from("workspace_whatsapp_numbers")
    .select("id,workspace_id,integration_id,phone_number_id,intake_schema_id")
    .eq("phone_number_id", event.phoneNumberId)
    .eq("is_active", true)
    .maybeSingle();
  if (!numberRow) return; // unknown/inactive number - safe no-op, matches Phase C routing behavior

  // Dedup: a webhook retry for a message StabiFlow already processed is a
  // safe no-op, never processed twice.
  const { data: duplicate } = await sb.from("inbox_messages").select("id").eq("provider_message_id", event.messageId).maybeSingle();
  if (duplicate) return;

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    workspace_id: numberRow.workspace_id,
    whatsapp_number_id: numberRow.id,
    wa_id: event.waId,
    phone_number: normalizePhone(event.waId),
    last_inbound_at: nowIso,
  };
  if (event.displayName) patch.display_name = event.displayName;
  if (event.referral?.sourceType) patch.referral_source = event.referral.sourceType;
  if (event.referral?.sourceId) patch.referral_ad_id = event.referral.sourceId;
  if (event.referral?.headline) patch.referral_headline = event.referral.headline;
  // ctwa_clid is an opaque per-click id, not a campaign id - Meta's real
  // referral payload never includes a campaign id (see the migration
  // comment on inbox_conversations.referral_click_id for the full
  // investigation). The deterministic campaign/ad_set/creative chain, when
  // resolvable, lives in attribution_events (recordConversationTouchpoint
  // below), not on this column.
  if (event.referral?.ctwaClid) patch.referral_click_id = event.referral.ctwaClid;

  // Attribution touchpoints belong to the CONVERSATION's creation, not to
  // every inbound message - detect insert-vs-update before the upsert so a
  // second/third message in an ongoing conversation never creates a
  // second touchpoint.
  const { data: existingConversation } = await sb
    .from("inbox_conversations")
    .select("id")
    .eq("whatsapp_number_id", numberRow.id)
    .eq("wa_id", event.waId)
    .maybeSingle();
  const isNewConversation = !existingConversation;

  const { data: conversation, error: conversationError } = await sb
    .from("inbox_conversations")
    .upsert(patch, { onConflict: "whatsapp_number_id,wa_id" })
    .select("id,workspace_id,status,ai_enabled,lead_id,intake_payload,intake_missing_fields,intake_schema_id,intake_completed_at")
    .single();
  if (conversationError || !conversation) {
    console.error("whatsapp-webhook: conversation upsert failed", conversationError?.message);
    return;
  }

  if (isNewConversation) {
    await recordConversationTouchpoint(sb, numberRow.workspace_id, conversation.id, nowIso, event.referral ?? null);
    await emitDomainEvent(sb, {
      workspaceId: numberRow.workspace_id,
      eventType: "conversation.started",
      entityType: "inbox_conversation",
      entityId: conversation.id,
      payload: { entity_id: conversation.id, wa_id: event.waId },
      dedupeKey: `conversation.started:${conversation.id}`,
    });
  }

  let mime = event.mime;
  let size: number | null = null;
  let sha256 = event.sha256;
  let storagePath: string | null = null;
  const cred = await resolveCredential(sb, numberRow);

  if ((event.kind === "image" || event.kind === "document") && event.mediaId && cred) {
    try {
      const media = await downloadWhatsAppMedia(cred, event.mediaId);
      mime = media.mime;
      size = media.size;
      sha256 = media.sha256 || sha256;
      const allowed = ALLOWED_INBOUND_MEDIA_MIME_TYPES.has(mime || "");
      if (allowed) {
        const ext = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
        const safeName = (event.filename || `whatsapp.${ext}`).replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${numberRow.workspace_id}/${conversation.id}/${Date.now()}-${event.messageId}-${safeName}`;
        const { error: uploadError } = await sb.storage.from("inbox-media").upload(path, media.bytes, { contentType: mime, upsert: false });
        if (!uploadError) storagePath = path;
      }
    } catch (mediaError) {
      console.error("whatsapp-webhook: media download failed", mediaError instanceof Error ? mediaError.message : mediaError);
    }
  }

  const inboundContent = event.text || (event.kind === "image" ? "[Image attached]" : event.kind === "document" ? "[Document attached]" : "[Unsupported message]");
  const { data: inboundMessage, error: inboundError } = await sb.from("inbox_messages").insert({
    workspace_id: numberRow.workspace_id,
    conversation_id: conversation.id,
    provider_message_id: event.messageId,
    direction: "inbound",
    sender_type: "customer",
    message_type: event.kind,
    content: inboundContent,
    media_id: event.mediaId,
    media_mime_type: mime,
    media_filename: event.filename,
    media_sha256: sha256,
    media_size_bytes: size,
    media_storage_path: storagePath,
  }).select("id").maybeSingle();
  if (inboundError && inboundError.code !== "23505") {
    console.error("whatsapp-webhook: inbound insert failed", inboundError.message);
    return;
  }
  if (inboundError?.code === "23505") return; // exact duplicate delivery, already recorded

  await emitDomainEvent(sb, {
    workspaceId: numberRow.workspace_id,
    eventType: "message.received",
    entityType: "inbox_conversation",
    entityId: conversation.id,
    payload: { entity_id: conversation.id, message_id: inboundMessage?.id ?? null, kind: event.kind },
    dedupeKey: `message.received:${event.messageId}`,
  });

  if (!cred) return; // no connected/working credential - leave for staff, cannot auto-reply
  if (!conversation.ai_enabled || conversation.status === "human_handoff") return; // human control is active - AI stays silent
  if (event.kind === "unsupported") {
    await storeOutbound(sb, cred, numberRow.workspace_id, conversation.id, event.waId, "Please send that as text, an image, or a PDF and I'll help you from there.", "system");
    return;
  }

  if (event.kind === "text" && isSimpleGreeting(event.text)) {
    await storeOutbound(sb, cred, numberRow.workspace_id, conversation.id, event.waId, "Hi! How can we help you today?");
    return;
  }

  const nowIso2 = new Date().toISOString();
  if (event.kind === "text" && requestsHumanHandoff(event.text)) {
    await sb.from("inbox_conversations").update({ status: "human_handoff", ai_enabled: false, human_handoff_requested_at: nowIso2 }).eq("id", conversation.id);
    await storeOutbound(sb, cred, numberRow.workspace_id, conversation.id, event.waId, "Of course - I'll hand this chat over to the team so someone can assist you.", "system");
    return;
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY")?.trim();
  const openaiModel = Deno.env.get("OPENAI_WHATSAPP_MODEL")?.trim();
  if (!openaiKey || !openaiModel) {
    console.error("whatsapp-webhook: OPENAI_API_KEY/OPENAI_WHATSAPP_MODEL not configured - leaving message for staff, no auto-reply");
    return;
  }

  const { data: rows } = await sb.from("inbox_messages").select("direction,content").eq("conversation_id", conversation.id).neq("provider_message_id", event.messageId).order("created_at", { ascending: false }).limit(16);
  const history = ([...(rows || [])].reverse()) as ConversationHistoryMessage[];
  const { data: workspaceRow } = await sb.from("workspaces").select("name").eq("id", numberRow.workspace_id).maybeSingle();
  const businessName = workspaceRow?.name || "our team";

  // Phase 3: when the workspace has an active intake schema, the AI works
  // to that schema - extracting only its fields, asking the single next
  // missing question, and driving the conversation.intake_completed event.
  // A workspace with no schema falls through to the unchanged legacy path
  // below (zero behaviour change).
  const schema = await resolveActiveIntakeSchema(sb, numberRow.workspace_id, {
    conversationSchemaId: (conversation.intake_schema_id as string | null) ?? null,
    numberSchemaId: numberRow.intake_schema_id,
  });
  if (schema) {
    const { fields: currentFields } = readIntakePayload(conversation.intake_payload);
    const preEval = evaluateIntake(schema, currentFields);

    let sr;
    try {
      sr = await generateStructuredReply({ apiKey: openaiKey, model: openaiModel }, businessName, history, event.text, currentFields, schema, preEval);
    } catch (aiError) {
      console.error("whatsapp-webhook: structured AI reply failed", aiError instanceof Error ? aiError.message : aiError);
      return;
    }

    if (sr.human_handoff_requested) {
      await sb.from("inbox_conversations").update({ status: "human_handoff", ai_enabled: false, human_handoff_requested_at: new Date().toISOString() }).eq("id", conversation.id);
      await storeOutbound(sb, cred, numberRow.workspace_id, conversation.id, event.waId, "Of course - I'll hand this chat over to the team so someone can assist you.", "system");
      return;
    }

    const merged = mergeExtractedFields(schema, currentFields, sr.fields);
    const postEval = evaluateIntake(schema, merged.fields);
    const summaryAnswer = postEval.collected.find((c) => c.key === "summary" || c.key === "interest_summary");
    await sb.from("inbox_conversations").update({
      intake_payload: writeIntakePayload(schema.id, merged.fields),
      intake_missing_fields: postEval.missing_required,
      intake_schema_id: schema.id,
      ...(typeof summaryAnswer?.value === "string" ? { ai_summary: summaryAnswer.value } : {}),
    }).eq("id", conversation.id);

    // Completion transition: stamp exactly once (race-safe conditional
    // UPDATE), and emit only if THIS call won the stamp. emitDomainEvent's
    // own dedupe_key unique index is the second line of defence.
    const decision = resolveIntakeCompletion(conversation.id, conversation.intake_completed_at as string | null, postEval);
    if (decision.should_emit) {
      const { data: stamped } = await sb
        .from("inbox_conversations")
        .update({ intake_completed_at: new Date().toISOString() })
        .eq("id", conversation.id)
        .is("intake_completed_at", null)
        .select("id")
        .maybeSingle();
      if (stamped) {
        await emitDomainEvent(sb, {
          workspaceId: numberRow.workspace_id,
          eventType: "conversation.intake_completed",
          entityType: "inbox_conversation",
          entityId: conversation.id,
          payload: { entity_id: conversation.id, conversation_id: conversation.id, schema_id: schema.id, lead_id: (conversation.lead_id as string | null) ?? null },
          dedupeKey: decision.dedupe_key,
        });
      }
    }

    let structuredAnswer = cleanReply(sr.reply);
    if (containsInventedPersonalIdentity(structuredAnswer)) structuredAnswer = "I'm an AI-assisted assistant here to help. How can we help you today?";
    if (containsFalseActionClaim(structuredAnswer)) structuredAnswer = "Thanks for the details - a team member will follow up on this.";
    await storeOutbound(sb, cred, numberRow.workspace_id, conversation.id, event.waId, structuredAnswer || "Thanks for reaching out - how can we help?");
    return;
  }

  let ai;
  try {
    ai = await generateAIReply({ apiKey: openaiKey, model: openaiModel }, businessName, history, event.text, (conversation.intake_payload || {}) as Record<string, unknown>);
  } catch (aiError) {
    console.error("whatsapp-webhook: AI reply generation failed", aiError instanceof Error ? aiError.message : aiError);
    return;
  }

  if (ai.human_handoff_requested) {
    await sb.from("inbox_conversations").update({ status: "human_handoff", ai_enabled: false, human_handoff_requested_at: new Date().toISOString() }).eq("id", conversation.id);
    await storeOutbound(sb, cred, numberRow.workspace_id, conversation.id, event.waId, "Of course - I'll hand this chat over to the team so someone can assist you.", "system");
    return;
  }

  const nextIntake = mergeExtracted((conversation.intake_payload || {}) as Record<string, unknown>, ai.extracted);
  const nextMissing = missingFields(nextIntake);
  await sb.from("inbox_conversations").update({
    intake_payload: nextIntake,
    intake_missing_fields: nextMissing,
    ai_summary: ai.extracted.interest_summary || null,
  }).eq("id", conversation.id);

  let answer = cleanReply(ai.reply);
  if (containsInventedPersonalIdentity(answer)) answer = "I'm an AI-assisted assistant here to help. How can we help you today?";
  if (containsFalseActionClaim(answer)) answer = "Thanks for the details - a team member will follow up on this.";
  await storeOutbound(sb, cred, numberRow.workspace_id, conversation.id, event.waId, answer || "Thanks for reaching out - how can we help?");
}

Deno.serve(async (req: Request) => {
  const reqUrl = new URL(req.url);

  if (req.method === "GET") {
    // Meta's one-time verification handshake when the webhook URL is
    // configured in the App dashboard.
    const challenge = verifyWebhookChallenge({
      mode: reqUrl.searchParams.get("hub.mode"),
      verifyToken: reqUrl.searchParams.get("hub.verify_token"),
      expectedVerifyToken: envVar("WHATSAPP_WEBHOOK_VERIFY_TOKEN"),
      challenge: reqUrl.searchParams.get("hub.challenge"),
    });
    if (challenge === null) return text("Forbidden", 403);
    return text(challenge, 200);
  }

  if (req.method !== "POST") return text("Method not allowed", 405);

  const rawBody = await req.text();
  const signatureHeader = req.headers.get("x-hub-signature-256");
  const appSecret = envVar("INTEGRATIONS_META_APP_SECRET");
  const verified = await verifyMetaWebhookSignature(appSecret, rawBody, signatureHeader);
  if (!verified) return text("Forbidden", 403);

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Signature was valid but the body isn't JSON - ack anyway so Meta
    // doesn't retry-storm a malformed delivery it will never fix.
    return text("OK", 200);
  }

  const serviceSb = createServiceClient();

  // Phase C's routing/idempotency ledger (instruction #15/#41): records
  // EVERY event (message or status) keyed on (phone_number_id,
  // provider_event_id), independent of whether Phase D's richer processing
  // below succeeds - this is what proves "duplicate delivery can never be
  // processed twice" and "an unknown number is a safe no-op" regardless of
  // any bug in the newer conversation/AI logic. Kept as its own pass rather
  // than folded into processMessageEvent so a webhook_events row always
  // exists even for status callbacks, which processMessageEvent never sees.
  for (const routable of parseWhatsAppWebhookEvents(payload)) {
    const { data: numberRow } = await serviceSb.from("workspace_whatsapp_numbers").select("workspace_id").eq("phone_number_id", routable.phoneNumberId).eq("is_active", true).maybeSingle();
    const { error: insertError } = await serviceSb.from("workspace_whatsapp_webhook_events").insert({
      workspace_id: numberRow?.workspace_id ?? null,
      phone_number_id: routable.phoneNumberId,
      provider_event_id: routable.eventId,
      event_type: routable.eventType,
      payload_summary: { resolved: !!numberRow },
    });
    if (insertError && insertError.code !== "23505") console.error("whatsapp-webhook: failed to record routing event", insertError.message);
  }

  for (const status of incomingStatuses(payload)) {
    try {
      await applyStatusUpdate(serviceSb, status);
    } catch (statusError) {
      console.error("whatsapp-webhook: status processing error", statusError instanceof Error ? statusError.message : statusError);
    }
  }

  for (const event of parseInboundMessageEvents(payload)) {
    try {
      await processMessageEvent(serviceSb, event);
    } catch (messageError) {
      console.error("whatsapp-webhook: message processing error", messageError instanceof Error ? messageError.message : messageError);
    }
  }

  // Meta expects a fast 200 ack regardless of what processing found - a
  // slow or non-200 response causes Meta to retry (and eventually disable)
  // the subscription.
  return text("OK", 200);
});

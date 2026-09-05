// Phase 10 - WhatsApp voice notes + safe transcription.
//
// The pure decision + provider-seam logic (MIME support, size cap, the
// state machine, the OpenAI /v1/audio/transcriptions request shape, the
// untrusted-transcript boundary, the empty-transcript guard, intake
// extraction) is covered by the Deno unit tests:
//   supabase/functions/_shared/inbox/voiceTranscription.test.ts
//   supabase/functions/_shared/inbox/webhookMessageParser.test.ts
//   supabase/functions/_shared/inbox/aiReplyEngine.test.ts
// - no OpenAI call is made there (an injected stub fetch).
//
// This suite proves, against the REAL local whatsapp-webhook + inbox-actions
// + leads-actions and REAL RLS, the parts that need the database + storage:
//   * an inbound voice/audio event becomes a normal inbound message row
//   * webhook replay never duplicates the message
//   * transcription defaults OFF (no state, no usage row)
//   * a human-controlled conversation never gets an AI reply from a voice note
//   * conversation.document_received is NOT emitted for audio
//   * the private inbox-media object is signable by the owning workspace and
//     NOT by another workspace (cross-tenant playback rejected)
//   * retry_transcription requires inbox.manage, rejects a cross-workspace
//     message, and refuses an already-transcribed note
//   * the Phase-2 lead-attachment flow references the same audio object
// No real WhatsApp / Meta / OpenAI call happens: the number credential is a
// mock token (Meta media download -> failure path) and the local edge
// runtime has no OPENAI_API_KEY, so transcription never reaches a provider.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin, cleanupTenant, createTestTenant, createTestUser, getTestEnv, seedMembership, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedInboxConversation, seedInboxMessage, seedWhatsAppSetup } from "./inboxHelpers";
import { seedPipeline } from "./leadsHelpers";

const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;
const ACTIONS_URL = `${SUPABASE_URL}/functions/v1/inbox-actions`;
const LEADS_URL = `${SUPABASE_URL}/functions/v1/leads-actions`;
const APP_SECRET = getTestEnv("INTEGRATIONS_META_APP_SECRET");

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return "sha256=" + [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function postWebhook(body: string) {
  const res = await fetch(WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json", "x-hub-signature-256": await sign(body) }, body });
  return res.status;
}
async function tokenFor(t: { client: SupabaseClient }) {
  const { data } = await t.client.auth.getSession();
  return data.session!.access_token;
}
async function callActions(token: string, body: Record<string, unknown>) {
  const res = await fetch(ACTIONS_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function callLeads(token: string, body: Record<string, unknown>) {
  const res = await fetch(LEADS_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function audioPayload(phoneNumberId: string, messageId: string, waId: string, opts: { voice?: boolean; mime?: string } = {}) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "waba", changes: [{ field: "messages", value: {
      metadata: { phone_number_id: phoneNumberId },
      contacts: [{ wa_id: waId, profile: { name: "Voice Sender" } }],
      messages: [{
        from: waId, id: messageId, type: "audio",
        audio: { id: `media-${messageId}`, mime_type: opts.mime ?? "audio/ogg; codecs=opus", sha256: "vv", voice: opts.voice ?? true },
      }],
    } }] }],
  });
}

async function messages(conversationId: string) {
  const { data } = await admin.from("inbox_messages")
    .select("id, direction, sender_type, message_type, content, media_id, media_mime_type, media_storage_path, transcription_status, transcript")
    .eq("conversation_id", conversationId).order("created_at");
  return data ?? [];
}
async function eventCount(eventType: string, conversationId: string) {
  const { count } = await admin.from("domain_events").select("id", { count: "exact", head: true })
    .eq("event_type", eventType).eq("entity_id", conversationId);
  return count ?? 0;
}
async function voiceUsageRows(workspaceId: string) {
  const { data } = await admin.from("ai_usage_events").select("id, status")
    .eq("workspace_id", workspaceId).eq("feature", "whatsapp_voice_transcription");
  return data ?? [];
}

describe("Phase 10 - WhatsApp voice notes + safe transcription", () => {
  let ws: TestTenant;
  let other: TestTenant;
  let phoneNumberId: string;
  let numberId: string;

  beforeAll(async () => {
    ws = await createTestTenant("voice");
    other = await createTestTenant("voice-other");
    const num = await seedWhatsAppSetup(ws.workspaceId);
    numberId = num.id;
    phoneNumberId = num.phone_number_id;
    await admin.rpc("set_workspace_integration_secret", {
      p_integration_id: (await admin.from("workspace_whatsapp_numbers").select("integration_id").eq("id", numberId).single()).data!.integration_id,
      p_secret: "mock-whatsapp-token-not-a-real-credential",
    });
    await seedWhatsAppSetup(other.workspaceId);
  });
  afterAll(async () => {
    await cleanupTenant(ws);
    await cleanupTenant(other);
  });

  // --- the opt-in -------------------------------------------------------

  it("ai_voice_transcription_enabled defaults OFF for a new workspace", async () => {
    const { data } = await admin.from("workspace_settings").select("ai_voice_transcription_enabled").eq("workspace_id", ws.workspaceId).single();
    expect(data!.ai_voice_transcription_enabled).toBe(false);
  });

  it("only an admin/owner can turn voice transcription on (RLS)", async () => {
    const marketing = await createTestUser("voice-mkt");
    await seedMembership(ws.workspaceId, marketing.userId, "marketing");
    const { data: blocked } = await marketing.client.from("workspace_settings")
      .update({ ai_voice_transcription_enabled: true }).eq("workspace_id", ws.workspaceId).select("workspace_id");
    expect(blocked ?? []).toEqual([]);
    const { error: ok } = await ws.client.from("workspace_settings").update({ ai_voice_transcription_enabled: true }).eq("workspace_id", ws.workspaceId);
    expect(ok).toBeNull();
    await ws.client.from("workspace_settings").update({ ai_voice_transcription_enabled: false }).eq("workspace_id", ws.workspaceId); // restore
    await cleanupTenant({ userId: marketing.userId });
  });

  // --- webhook: parsed, stored as a normal message, replay-safe --------

  it("an inbound voice note becomes a normal inbound message row (voice), replay never duplicates it", async () => {
    const wa = "27820000701";
    const mid = `wamid.voice-${Date.now()}`;
    expect(await postWebhook(audioPayload(phoneNumberId, mid, wa, { voice: true }))).toBe(200);
    expect(await postWebhook(audioPayload(phoneNumberId, mid, wa, { voice: true }))).toBe(200); // Meta retry

    const { data: conv } = await admin.from("inbox_conversations").select("id").eq("whatsapp_number_id", numberId).eq("wa_id", wa).single();
    const msgs = await messages(conv!.id);
    const inbound = msgs.filter((m) => m.direction === "inbound");
    expect(inbound).toHaveLength(1);
    expect(inbound[0].message_type).toBe("voice");
    expect(inbound[0].sender_type).toBe("customer");
    expect(inbound[0].content).toBe("[Voice note]");
    expect(inbound[0].media_id).toBe(`media-${mid}`);
    expect(inbound[0].media_mime_type).toContain("audio/ogg");
    // one message.received (kind voice), and NO conversation.document_received
    expect(await eventCount("message.received", conv!.id)).toBe(1);
    expect(await eventCount("conversation.document_received", conv!.id)).toBe(0);
  });

  it("a regular audio file (voice flag false) is stored as message_type 'audio'", async () => {
    const wa = "27820000702";
    const mid = `wamid.audio-${Date.now()}`;
    expect(await postWebhook(audioPayload(phoneNumberId, mid, wa, { voice: false, mime: "audio/mpeg" }))).toBe(200);
    const { data: conv } = await admin.from("inbox_conversations").select("id").eq("whatsapp_number_id", numberId).eq("wa_id", wa).single();
    const inbound = (await messages(conv!.id)).filter((m) => m.direction === "inbound");
    expect(inbound[0].message_type).toBe("audio");
    expect(inbound[0].content).toBe("[Audio message]");
  });

  it("transcription defaults OFF: no transcription_status, no voice usage row, inbound message intact", async () => {
    const wa = "27820000703";
    const mid = `wamid.off-${Date.now()}`;
    await admin.from("workspace_settings").update({ ai_voice_transcription_enabled: false }).eq("workspace_id", ws.workspaceId);
    expect(await postWebhook(audioPayload(phoneNumberId, mid, wa, { voice: true }))).toBe(200);
    const { data: conv } = await admin.from("inbox_conversations").select("id").eq("whatsapp_number_id", numberId).eq("wa_id", wa).single();
    const inbound = (await messages(conv!.id)).filter((m) => m.direction === "inbound");
    expect(inbound).toHaveLength(1);
    expect(inbound[0].transcription_status).toBeNull();
    expect(inbound[0].transcript).toBeNull();
    expect(await voiceUsageRows(ws.workspaceId)).toEqual([]);
  });

  it("an unsupported audio MIME is still stored + visible, never a fabricated transcript", async () => {
    const wa = "27820000704";
    const mid = `wamid.weird-${Date.now()}`;
    expect(await postWebhook(audioPayload(phoneNumberId, mid, wa, { voice: true, mime: "audio/x-weird" }))).toBe(200);
    const { data: conv } = await admin.from("inbox_conversations").select("id").eq("whatsapp_number_id", numberId).eq("wa_id", wa).single();
    const inbound = (await messages(conv!.id)).filter((m) => m.direction === "inbound");
    expect(inbound).toHaveLength(1);
    expect(inbound[0].message_type).toBe("voice");
    expect(inbound[0].transcript).toBeNull();
  });

  it("a human-controlled conversation never gets an AI reply from a voice note", async () => {
    const wa = "27820000705";
    const conv = await seedInboxConversation(ws.workspaceId, numberId, {
      wa_id: wa, phone_number: `+${wa}`, status: "human_handoff", ai_enabled: false, inbox_status: "unassigned",
    });
    expect(await postWebhook(audioPayload(phoneNumberId, `wamid.hc-${Date.now()}`, wa, { voice: true }))).toBe(200);
    const msgs = await messages(conv.id);
    expect(msgs.filter((m) => m.direction === "inbound")).toHaveLength(1);
    expect(msgs.filter((m) => m.direction === "outbound")).toHaveLength(0); // AI stayed silent
  });

  // --- private audio: signable by the owner, not by another workspace --

  it("the stored audio object is signable by the owning workspace and rejected for another workspace (RLS)", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { wa_id: "27820000706", phone_number: "+27820000706" });
    const path = `${ws.workspaceId}/${conv.id}/${Date.now()}-voice.ogg`;
    await admin.storage.from("inbox-media").upload(path, new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/ogg" }), { upsert: true });
    await seedInboxMessage(ws.workspaceId, conv.id, {
      message_type: "voice", content: "[Voice note]", media_storage_path: path, media_mime_type: "audio/ogg", media_size_bytes: 4,
    });

    const mine = await ws.client.storage.from("inbox-media").createSignedUrl(path, 300);
    expect(mine.error).toBeNull();
    expect(mine.data?.signedUrl).toBeTruthy();

    const theirs = await other.client.storage.from("inbox-media").createSignedUrl(path, 300);
    expect(theirs.data?.signedUrl ?? null).toBeNull(); // RLS: path prefix workspace != caller's
  });

  // --- retry_transcription: ownership + permission + state gates -------

  it("retry_transcription rejects a cross-workspace message id (404) and requires inbox.manage", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { wa_id: "27820000707", phone_number: "+27820000707" });
    const path = `${ws.workspaceId}/${conv.id}/${Date.now()}-voice.ogg`;
    await admin.storage.from("inbox-media").upload(path, new Blob([new Uint8Array([5, 5])], { type: "audio/ogg" }), { upsert: true });
    const msgId = await seedInboxMessage(ws.workspaceId, conv.id, {
      message_type: "voice", content: "[Voice note]", media_storage_path: path, media_mime_type: "audio/ogg", media_size_bytes: 2, transcription_status: "failed",
    });

    // another workspace cannot act on this conversation/message at all
    const foreign = await callActions(await tokenFor(other), { workspace_id: other.workspaceId, conversation_id: conv.id, action: "retry_transcription", message_id: msgId });
    expect(foreign.status).toBe(404);

    // a non-manage member of the OWNING workspace is refused
    const viewer = await createTestUser("voice-viewer");
    await seedMembership(ws.workspaceId, viewer.userId, "marketing");
    const denied = await callActions(await tokenFor(viewer), { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "retry_transcription", message_id: msgId });
    expect(denied.status).toBe(403);
    await cleanupTenant({ userId: viewer.userId });

    // the owner passes the gates (no OPENAI key in the local edge runtime ->
    // an honest "not configured" rather than a real provider call)
    const owner = await callActions(await tokenFor(ws), { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "retry_transcription", message_id: msgId });
    expect([503, 200]).toContain(owner.status);
    if (owner.status === 503) expect(owner.body.code).toBe("transcription_unavailable");
    // the stored audio + message row are untouched by a failed retry
    const still = (await messages(conv.id)).find((m) => m.id === msgId);
    expect(still?.media_storage_path).toBe(path);
    expect(still?.transcript ?? null).toBeNull();
  });

  it("retry_transcription refuses an already-transcribed voice note", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { wa_id: "27820000708", phone_number: "+27820000708" });
    const path = `${ws.workspaceId}/${conv.id}/${Date.now()}-voice.ogg`;
    await admin.storage.from("inbox-media").upload(path, new Blob([new Uint8Array([7])], { type: "audio/ogg" }), { upsert: true });
    const msgId = await seedInboxMessage(ws.workspaceId, conv.id, {
      message_type: "voice", content: "[Voice note]", media_storage_path: path, media_mime_type: "audio/ogg", media_size_bytes: 1,
      transcription_status: "processed", transcript: "already have this",
    });
    const res = await callActions(await tokenFor(ws), { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "retry_transcription", message_id: msgId });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("already_transcribed");
    const still = (await messages(conv.id)).find((m) => m.id === msgId);
    expect(still?.transcript).toBe("already have this"); // unchanged - audio + transcript preserved
  });

  // --- Phase-2 lead attachment still references the same audio ---------

  it("Phase-2 conversion links the original voice-note audio object to the CRM lead", async () => {
    const pipe = await seedPipeline(ws.workspaceId);
    const conv = await seedInboxConversation(ws.workspaceId, numberId, {
      wa_id: "27820000709", phone_number: "+27820000709", intake_completed_at: new Date().toISOString(),
      intake_payload: { schema_id: null, fields: { customer_name: "Voice Co", interest_summary: "Left a voice note" } },
    });
    const path = `${ws.workspaceId}/${conv.id}/${Date.now()}-voice.ogg`;
    await admin.storage.from("inbox-media").upload(path, new Blob([new Uint8Array([9, 9])], { type: "audio/ogg" }), { upsert: true });
    await seedInboxMessage(ws.workspaceId, conv.id, {
      message_type: "voice", content: "[Voice note]", media_storage_path: path, media_mime_type: "audio/ogg", media_size_bytes: 2,
    });
    const res = await callLeads(await tokenFor(ws), {
      workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id,
      pipeline_id: pipe.pipelineId, pipeline_stage_id: pipe.stages[0].id,
    });
    expect(res.status).toBe(200);
    const leadId = res.body?.lead?.id;
    expect(leadId).toBeTruthy();
    const { data: atts } = await admin.from("lead_attachments").select("storage_path, media_mime_type").eq("lead_id", leadId);
    const linked = (atts ?? []).find((a) => a.storage_path === path);
    expect(linked).toBeTruthy();
    expect(linked!.media_mime_type).toBe("audio/ogg");
  });
});

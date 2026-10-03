// Phase 6 - Multimodal WhatsApp AI + document understanding.
//
// The AI-input construction (image/PDF parts, bounded selection, capability
// guard, untrusted-attachment prompt boundary, malformed-response handling)
// is covered by the pure Deno unit tests:
//   supabase/functions/_shared/inbox/multimodalMedia.test.ts
//   supabase/functions/_shared/inbox/aiReplyEngine.test.ts
// - no OpenAI call is ever made there (an injected stub fetch).
//
// This suite proves, against the REAL local whatsapp-webhook + leads-actions
// and REAL RLS, the parts that need the database:
//   * the ai_multimodal opt-in defaults OFF and is admin-only (RLS)
//   * a supported inbound attachment records the message + emits
//     conversation.document_received exactly once (webhook replay safe)
//   * a conversation under human control is never AI-processed
//   * a media-download failure never loses the inbound message
//   * ai_usage_events(feature='whatsapp_inbox_ai') is workspace-scoped and
//     billing-gated
//   * Phase-2 conversion still links the original attachment to the lead
//   * a text-only conversation behaves exactly as before
// No real WhatsApp / Meta / OpenAI call happens: the number's credential is
// a mock token (Meta media download -> failure path) and the local edge
// runtime has no OPENAI_API_KEY, so the AI branch is never entered.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin, cleanupTenant, createTestTenant, createTestUser, getTestEnv, seedMembership, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedInboxConversation, seedInboxMessage, seedWhatsAppSetup } from "./inboxHelpers";
import { seedLead, seedPipeline } from "./leadsHelpers";

const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;
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
function mediaPayload(phoneNumberId: string, messageId: string, waId: string, kind: "image" | "document", mime: string) {
  const media = kind === "image"
    ? { id: "media-abc", mime_type: mime, sha256: "deadbeef", caption: "" }
    : { id: "media-abc", mime_type: mime, sha256: "deadbeef", filename: "invoice.pdf", caption: "" };
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "waba", changes: [{ field: "messages", value: {
      metadata: { phone_number_id: phoneNumberId },
      contacts: [{ wa_id: waId, profile: { name: "Docs Sender" } }],
      messages: [{ from: waId, id: messageId, type: kind, [kind]: media }],
    } }] }],
  });
}
function textPayload(phoneNumberId: string, messageId: string, waId: string, text: string) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "waba", changes: [{ field: "messages", value: {
      metadata: { phone_number_id: phoneNumberId },
      contacts: [{ wa_id: waId, profile: { name: "Text Sender" } }],
      messages: [{ from: waId, id: messageId, type: "text", text: { body: text } }],
    } }] }],
  });
}
async function tokenFor(t: { client: SupabaseClient }) {
  const { data } = await t.client.auth.getSession();
  return data.session!.access_token;
}
async function callLeads(token: string, body: Record<string, unknown>) {
  const res = await fetch(LEADS_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function docReceivedCount(conversationId: string) {
  const { count } = await admin.from("domain_events").select("id", { count: "exact", head: true })
    .eq("event_type", "conversation.document_received").eq("entity_id", conversationId);
  return count ?? 0;
}
async function messages(conversationId: string) {
  const { data } = await admin.from("inbox_messages")
    .select("id, direction, message_type, ai_media_status, media_storage_path")
    .eq("conversation_id", conversationId).order("created_at");
  return data ?? [];
}

describe("Phase 6 - Multimodal WhatsApp AI", () => {
  let ws: TestTenant;
  let other: TestTenant;
  let phoneNumberId: string;
  let numberId: string;

  beforeAll(async () => {
    ws = await createTestTenant("mm");
    other = await createTestTenant("mm-other");
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

  // --- the opt-in ---------------------------------------------------

  it("ai_multimodal_enabled defaults OFF for a new workspace", async () => {
    const { data } = await admin.from("workspace_settings").select("ai_multimodal_enabled").eq("workspace_id", ws.workspaceId).single();
    expect(data!.ai_multimodal_enabled).toBe(false);
  });

  it("only an admin/owner can turn multimodal on (RLS)", async () => {
    const marketing = await createTestUser("mm-mkt");
    await seedMembership(ws.workspaceId, marketing.userId, "marketing");
    const { data: blocked } = await marketing.client.from("workspace_settings")
      .update({ ai_multimodal_enabled: true }).eq("workspace_id", ws.workspaceId).select("workspace_id");
    expect(blocked ?? []).toEqual([]); // RLS filtered the row - nothing changed
    let { data: still } = await admin.from("workspace_settings").select("ai_multimodal_enabled").eq("workspace_id", ws.workspaceId).single();
    expect(still!.ai_multimodal_enabled).toBe(false);

    const { error: ok } = await ws.client.from("workspace_settings").update({ ai_multimodal_enabled: true }).eq("workspace_id", ws.workspaceId);
    expect(ok).toBeNull();
    ({ data: still } = await admin.from("workspace_settings").select("ai_multimodal_enabled").eq("workspace_id", ws.workspaceId).single());
    expect(still!.ai_multimodal_enabled).toBe(true);
    await ws.client.from("workspace_settings").update({ ai_multimodal_enabled: false }).eq("workspace_id", ws.workspaceId); // restore
    await cleanupTenant({ userId: marketing.userId });
  });

  // --- webhook: received, deduped, no message loss -----------------

  it("a supported PDF records the inbound message and emits conversation.document_received exactly once (replay-safe)", async () => {
    const wa = "27820000601";
    const mid = `wamid.pdf-${Date.now()}`;
    expect(await postWebhook(mediaPayload(phoneNumberId, mid, wa, "document", "application/pdf"))).toBe(200);
    expect(await postWebhook(mediaPayload(phoneNumberId, mid, wa, "document", "application/pdf"))).toBe(200); // retry

    const { data: conv } = await admin.from("inbox_conversations").select("id").eq("wa_id", wa).single();
    const msgs = await messages(conv!.id);
    const inbound = msgs.filter((m) => m.direction === "inbound");
    expect(inbound).toHaveLength(1); // deduped on provider_message_id
    expect(inbound[0].message_type).toBe("document");
    // Meta media download uses a mock token -> failure path, so nothing was
    // stored, but the message is NOT lost.
    expect(inbound[0].media_storage_path).toBeNull();
    expect(inbound[0].ai_media_status).toBeNull(); // AI branch never entered (no OPENAI key locally)
    expect(await docReceivedCount(conv!.id)).toBe(1); // one, not two
  });

  it("an image to a human-controlled conversation is stored but never AI-processed", async () => {
    const wa = "27820000602";
    const conv = await seedInboxConversation(ws.workspaceId, numberId, {
      wa_id: wa, phone_number: `+${wa}`, status: "human_handoff", ai_enabled: false, inbox_status: "assigned",
    });
    expect(await postWebhook(mediaPayload(phoneNumberId, `wamid.img-${Date.now()}`, wa, "image", "image/png"))).toBe(200);
    const msgs = await messages(conv.id);
    expect(msgs.some((m) => m.direction === "inbound" && m.message_type === "image")).toBe(true);
    expect(msgs.some((m) => m.direction === "outbound")).toBe(false); // AI stayed silent under human control
    expect(msgs.find((m) => m.direction === "inbound")!.ai_media_status).toBeNull();
  });

  it("a text-only conversation behaves exactly as before (inbound recorded, no media columns touched)", async () => {
    const wa = "27820000603";
    expect(await postWebhook(textPayload(phoneNumberId, `wamid.txt-${Date.now()}`, wa, "just a normal question"))).toBe(200);
    const { data: conv } = await admin.from("inbox_conversations").select("id").eq("wa_id", wa).single();
    const msgs = await messages(conv!.id);
    const inbound = msgs.filter((m) => m.direction === "inbound");
    expect(inbound).toHaveLength(1);
    expect(inbound[0].message_type).toBe("text");
    expect(inbound[0].ai_media_status).toBeNull();
    expect(await docReceivedCount(conv!.id)).toBe(0); // not a document
  });

  // --- usage ledger + isolation ----------------------------------

  it("ai_usage_events(feature='whatsapp_inbox_ai') is workspace-scoped and billing-gated", async () => {
    await admin.from("ai_usage_events").insert({
      workspace_id: ws.workspaceId, feature: "whatsapp_inbox_ai", provider: "openai",
      model: "gpt-4o-mini", input_tokens: 100, output_tokens: 40, status: "success",
    });
    // owner holds manage_billing -> can read its own workspace's rows
    const { data: mine } = await ws.client.from("ai_usage_events").select("feature").eq("workspace_id", ws.workspaceId).eq("feature", "whatsapp_inbox_ai");
    expect((mine ?? []).length).toBeGreaterThanOrEqual(1);
    // another workspace's owner sees nothing
    const { data: theirs } = await other.client.from("ai_usage_events").select("id").eq("workspace_id", ws.workspaceId);
    expect(theirs ?? []).toEqual([]);
  });

  it("cross-workspace: another workspace cannot read this workspace's inbox-media object", async () => {
    const conv = await seedInboxConversation(ws.workspaceId, numberId, { wa_id: "27820000604", phone_number: "+27820000604" });
    const path = `${ws.workspaceId}/${conv.id}/${Date.now()}-secret.pdf`;
    await admin.storage.from("inbox-media").upload(path, new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" }), { upsert: true });
    const { data, error } = await other.client.storage.from("inbox-media").download(path);
    expect(!!data && !error).toBe(false); // storage RLS denies it
  });

  // --- Phase-2 regression --------------------------------------

  it("Phase-2 conversion still links the original attachment to the CRM lead", async () => {
    const pipe = await seedPipeline(ws.workspaceId);
    const conv = await seedInboxConversation(ws.workspaceId, numberId, {
      wa_id: "27820000605", phone_number: "+27820000605", intake_completed_at: new Date().toISOString(),
      intake_payload: { schema_id: null, fields: { customer_name: "Doc Co", interest_summary: "Invoice question" } },
    });
    const path = `${ws.workspaceId}/${conv.id}/${Date.now()}-invoice.pdf`;
    await admin.storage.from("inbox-media").upload(path, new Blob([new Uint8Array([9, 9, 9])], { type: "application/pdf" }), { upsert: true });
    await seedInboxMessage(ws.workspaceId, conv.id, { message_type: "document", content: "[Document attached]", media_storage_path: path, media_mime_type: "application/pdf", media_filename: "invoice.pdf", media_size_bytes: 3 });

    const res = await callLeads(await tokenFor(ws), {
      workspace_id: ws.workspaceId, action: "create_from_conversation", conversation_id: conv.id,
      pipeline_id: pipe.pipelineId, pipeline_stage_id: pipe.stages[0].id,
    });
    expect(res.status).toBe(200);
    const leadId = res.body?.lead?.id;
    expect(leadId).toBeTruthy();
    const { data: atts } = await admin.from("lead_attachments").select("storage_path").eq("lead_id", leadId);
    expect((atts ?? []).some((a) => a.storage_path === path)).toBe(true);
    void seedLead;
  });
});

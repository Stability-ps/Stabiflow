// Phase 13 - WhatsApp reply localization / customer language matching.
//
// Real LOCAL-Supabase tests (no mocks) for the parts that are DB / RLS /
// webhook-observable. The local edge runtime has NO OPENAI_API_KEY, so
// the AI reply path (and therefore the localization pass) never reaches a
// provider - which is exactly what lets us prove "no semantic reply ->
// no localization -> no usage row" end to end. The successful-localization
// and candidate-rejection logic is covered by the pure-helper unit tests
// in supabase/functions/_shared/inbox/replyLocalization.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, createTestUser, getTestEnv, seedMembership, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedInboxConversation, seedWhatsAppSetup } from "./inboxHelpers";

const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;
const APP_SECRET = getTestEnv("INTEGRATIONS_META_APP_SECRET");
const LOCALIZATION_FEATURE = "whatsapp_reply_localization";

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return "sha256=" + [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function postWebhook(body: string) {
  const res = await fetch(WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json", "x-hub-signature-256": await sign(body) }, body });
  return res.status;
}
function textPayload(phoneNumberId: string, messageId: string, waId: string, text: string) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "waba", changes: [{ field: "messages", value: {
      metadata: { phone_number_id: phoneNumberId },
      contacts: [{ wa_id: waId, profile: { name: "Lang Tester" } }],
      messages: [{ from: waId, id: messageId, type: "text", text: { body: text } }],
    } }] }],
  });
}
async function outboundCount(conversationId: string) {
  const { count } = await admin.from("inbox_messages").select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId).eq("direction", "outbound");
  return count ?? 0;
}
async function localizationUsageRows(workspaceId: string) {
  const { data } = await admin.from("ai_usage_events").select("id, status, total_tokens")
    .eq("workspace_id", workspaceId).eq("feature", LOCALIZATION_FEATURE);
  return data ?? [];
}

describe("Phase 13 - WhatsApp reply localization", () => {
  let ws: TestTenant;
  let other: TestTenant;
  let phoneNumberId: string;

  beforeAll(async () => {
    ws = await createTestTenant("loc");
    other = await createTestTenant("loc-other");
    const num = await seedWhatsAppSetup(ws.workspaceId);
    phoneNumberId = num.phone_number_id;
    await admin.rpc("set_workspace_integration_secret", {
      p_integration_id: (await admin.from("workspace_whatsapp_numbers").select("integration_id").eq("id", num.id).single()).data!.integration_id,
      p_secret: "mock-whatsapp-token-not-a-real-credential",
    });
    await seedWhatsAppSetup(other.workspaceId);
  });
  afterAll(async () => {
    await cleanupTenant(ws);
    await cleanupTenant(other);
  });

  it("match_customer_language defaults OFF for a new workspace", async () => {
    const { data } = await admin.from("workspace_settings").select("match_customer_language").eq("workspace_id", ws.workspaceId).single();
    expect(data?.match_customer_language).toBe(false);
  });

  it("a workspace admin/owner CAN enable it", async () => {
    const { error } = await ws.client.from("workspace_settings").update({ match_customer_language: true }).eq("workspace_id", ws.workspaceId);
    expect(error).toBeNull();
    const { data } = await admin.from("workspace_settings").select("match_customer_language").eq("workspace_id", ws.workspaceId).single();
    expect(data?.match_customer_language).toBe(true);
    await ws.client.from("workspace_settings").update({ match_customer_language: false }).eq("workspace_id", ws.workspaceId);
  });

  it("a non-admin member CANNOT change it (RLS: has_workspace_role admin)", async () => {
    const member = await createTestUser("loc-member");
    await seedMembership(ws.workspaceId, member.userId, "support");
    const { data } = await member.client.from("workspace_settings").update({ match_customer_language: true }).eq("workspace_id", ws.workspaceId).select();
    expect(data ?? []).toEqual([]); // 0 rows affected
    const { data: still } = await admin.from("workspace_settings").select("match_customer_language").eq("workspace_id", ws.workspaceId).single();
    expect(still?.match_customer_language).toBe(false);
  });

  it("workspace A cannot read or update workspace B's match_customer_language", async () => {
    await admin.from("workspace_settings").update({ match_customer_language: true }).eq("workspace_id", other.workspaceId);
    const { data: readB } = await ws.client.from("workspace_settings").select("match_customer_language").eq("workspace_id", other.workspaceId);
    expect(readB ?? []).toEqual([]);
    const { data: updB } = await ws.client.from("workspace_settings").update({ match_customer_language: false }).eq("workspace_id", other.workspaceId).select();
    expect(updB ?? []).toEqual([]);
    const { data: stillB } = await admin.from("workspace_settings").select("match_customer_language").eq("workspace_id", other.workspaceId).single();
    expect(stillB?.match_customer_language).toBe(true);
    await admin.from("workspace_settings").update({ match_customer_language: false }).eq("workspace_id", other.workspaceId);
  });

  it("the ai_usage_events ledger accepts feature='whatsapp_reply_localization' and it sums into the shared Inbox AI features", async () => {
    await admin.from("ai_usage_events").insert({
      workspace_id: ws.workspaceId, feature: LOCALIZATION_FEATURE, provider: "openai", model: "test-model",
      input_tokens: 90, output_tokens: 30, status: "success",
    });
    const { data } = await admin.from("ai_usage_events")
      .select("total_tokens")
      .eq("workspace_id", ws.workspaceId)
      .in("feature", ["whatsapp_inbox_ai", "whatsapp_voice_transcription", LOCALIZATION_FEATURE]);
    const sum = (data ?? []).reduce((s, r) => s + (r.total_tokens ?? 0), 0);
    expect(sum).toBeGreaterThanOrEqual(120);
    await admin.from("ai_usage_events").delete().eq("workspace_id", ws.workspaceId).eq("feature", LOCALIZATION_FEATURE);
  });

  it("setting ON but no provider configured -> no semantic reply, therefore no localization pass and no localization usage row", async () => {
    await admin.from("workspace_settings").update({ match_customer_language: true }).eq("workspace_id", ws.workspaceId);
    const conv = await seedInboxConversation(ws.workspaceId, (await admin.from("workspace_whatsapp_numbers").select("id").eq("workspace_id", ws.workspaceId).limit(1).single()).data!.id, {
      wa_id: "27830000013", phone_number: "+27830000013", status: "active", ai_enabled: true,
    });
    const status = await postWebhook(textPayload(phoneNumberId, `loc-nokey-${Date.now()}`, conv.wa_id, "Sharp, ngicela ukwazi ukuthi ngidingani for payment arrangement?"));
    expect(status).toBe(200);
    expect(await outboundCount(conv.id)).toBe(0); // no OPENAI key -> AI path leaves it for staff
    expect(await localizationUsageRows(ws.workspaceId)).toEqual([]);
    await admin.from("workspace_settings").update({ match_customer_language: false }).eq("workspace_id", ws.workspaceId);
  });

  it("a human-handoff conversation never produces an AI/localized outbound, even with the setting ON", async () => {
    await admin.from("workspace_settings").update({ match_customer_language: true }).eq("workspace_id", ws.workspaceId);
    const numId = (await admin.from("workspace_whatsapp_numbers").select("id").eq("workspace_id", ws.workspaceId).limit(1).single()).data!.id;
    const conv = await seedInboxConversation(ws.workspaceId, numId, {
      wa_id: "27830000014", phone_number: "+27830000014", status: "human_handoff", ai_enabled: false,
    });
    const status = await postWebhook(textPayload(phoneNumberId, `loc-handoff-${Date.now()}`, conv.wa_id, "molo, ndicela uncedo"));
    expect(status).toBe(200);
    expect(await outboundCount(conv.id)).toBe(0);
    expect(await localizationUsageRows(ws.workspaceId)).toEqual([]);
    await admin.from("workspace_settings").update({ match_customer_language: false }).eq("workspace_id", ws.workspaceId);
  });
});

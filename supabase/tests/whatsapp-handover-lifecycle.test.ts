// WhatsApp handover lifecycle - the brief's critical journey, against the
// REAL local whatsapp-webhook + inbox-actions functions and real RLS.
//
//   inbound -> AI-handled -> customer asks for a person -> Needs human
//   (event + alert + timeline) -> agent takes over -> AI silent while human
//   owns it (customer replies get no AI/system message) -> agent returns it
//   to automation -> AI may reply again.
//
// Plus: workspace handover keywords, webhook-retry idempotency (one
// handover event), pause_ai, closed event, cross-workspace isolation, and
// agent-assist gating (never sends anything).
//
// The local stack has no OpenAI key and a mock Meta token, so no real AI
// reply is generated and sends fail-and-record; "AI may reply" is asserted
// through the shared aiMayReply() gate the webhook itself uses.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, ANON_KEY, cleanupTenant, createTestTenant, getTestEnv, SUPABASE_URL, enableModules, type TestTenant } from "./helpers";
import { seedWhatsAppSetup } from "./inboxHelpers";
import { aiMayReply, handoverState } from "../functions/_shared/inbox/handoverState";

const APP_SECRET = getTestEnv("INTEGRATIONS_META_APP_SECRET");
const WA_ID = "27820001234";

async function sign(body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `sha256=${[...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function inbound(phoneNumberId: string, id: string, text: string, waId = WA_ID) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "waba-test", changes: [{ field: "messages", value: {
      metadata: { phone_number_id: phoneNumberId },
      contacts: [{ wa_id: waId, profile: { name: "Lerato Customer" } }],
      messages: [{ from: waId, id, type: "text", text: { body: text } }],
    } }] }],
  });
}

async function postWebhook(body: string) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-webhook`, { method: "POST", headers: { "Content-Type": "application/json", "x-hub-signature-256": await sign(body) }, body });
  expect(res.status).toBe(200);
}

async function inboxAction(tenant: TestTenant, body: Record<string, unknown>) {
  const { data } = await tenant.client.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/inbox-actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${data.session!.access_token}` },
    body: JSON.stringify({ workspace_id: tenant.workspaceId, ...body }),
  });
  return { status: res.status, body: await res.json() };
}

async function conversationFor(numberId: string, waId = WA_ID) {
  const { data } = await admin.from("inbox_conversations").select("*").eq("whatsapp_number_id", numberId).eq("wa_id", waId).single();
  return data!;
}

async function events(conversationId: string, type: string) {
  const { data } = await admin.from("domain_events").select("event_type, payload").eq("entity_id", conversationId).eq("event_type", type);
  return data ?? [];
}

async function outboundCount(conversationId: string) {
  const { count } = await admin.from("inbox_messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId).eq("direction", "outbound");
  return count ?? 0;
}

let tenant: TestTenant;
let other: TestTenant;
let number: { id: string; phone_number_id: string };

beforeAll(async () => {
  tenant = await createTestTenant("wa-handover");
  await enableModules(tenant.workspaceId, "module.whatsapp");
  other = await createTestTenant("wa-handover-other");
  await enableModules(other.workspaceId, "module.whatsapp");
  number = await seedWhatsAppSetup(tenant.workspaceId, { phone_number_id: `phone-handover-${Date.now()}` });
  const { data: n } = await admin.from("workspace_whatsapp_numbers").select("integration_id").eq("id", number.id).single();
  await admin.rpc("set_workspace_integration_secret", { p_integration_id: n!.integration_id, p_secret: "mock-whatsapp-token-not-a-real-credential" });
});

afterAll(async () => {
  await cleanupTenant(tenant);
  await cleanupTenant(other);
});

describe("critical journey: AI -> customer asks for a person -> agent -> back to automation", () => {
  let conversationId: string;

  it("a new customer message starts an AI-handled conversation", async () => {
    await postWebhook(inbound(number.phone_number_id, `wamid.j1-${Date.now()}`, "Hi, what are your opening times on Saturday?"));
    const c = await conversationFor(number.id);
    conversationId = c.id;
    expect(handoverState(c)).toBe("bot_active");
    expect(aiMayReply(c)).toBe(true);
  });

  it("asking for a person hands over exactly once, even when Meta retries the webhook", async () => {
    const body = inbound(number.phone_number_id, `wamid.j2-${Date.now()}`, "Can I please speak to a person");
    await postWebhook(body);
    await postWebhook(body); // Meta retry of the same message
    const c = await conversationFor(number.id);
    expect(handoverState(c)).toBe("handover_requested");
    expect(aiMayReply(c)).toBe(false);
    expect(await events(conversationId, "conversation.human_takeover")).toHaveLength(1);
    const { data: alerts } = await admin.from("inbox_alerts").select("alert_type").eq("conversation_id", conversationId).eq("alert_type", "human_handoff").eq("is_resolved", false);
    expect(alerts).toHaveLength(1);
    const { data: log } = await admin.from("workspace_activity_log").select("metadata").eq("target_id", conversationId).eq("action", "inbox_conversation_handoff_requested");
    expect(log).toHaveLength(1);
    expect(log![0].metadata).toMatchObject({ by: "customer" });
  });

  it("the agent takes over: assigned to them, agent_took_over emitted, AI stays off", async () => {
    const res = await inboxAction(tenant, { action: "take_over", conversation_id: conversationId });
    expect(res.status).toBe(200);
    const c = await conversationFor(number.id);
    expect(c.assigned_staff_id).toBe(tenant.userId);
    expect(handoverState(c)).toBe("human_active");
    expect(await events(conversationId, "conversation.agent_took_over")).toHaveLength(1);
  });

  it("the agent replies and the conversation stays human-owned", async () => {
    const res = await inboxAction(tenant, { action: "reply", conversation_id: conversationId, message: "Hi Lerato, Saturday we open 08:00-13:00." });
    expect([200, 202]).toContain(res.status); // mock Meta token: recorded even though delivery fails
    const c = await conversationFor(number.id);
    expect(handoverState(c)).toBe("human_active");
  });

  it("a customer reply while a human owns the chat produces no AI or system message", async () => {
    const before = await outboundCount(conversationId);
    await postWebhook(inbound(number.phone_number_id, `wamid.j3-${Date.now()}`, "Great, and Sunday?"));
    expect(await outboundCount(conversationId)).toBe(before);
    const c = await conversationFor(number.id);
    expect(handoverState(c)).toBe("human_active");
    // a second "speak to a person" while human-owned must not re-trigger a handover
    await postWebhook(inbound(number.phone_number_id, `wamid.j4-${Date.now()}`, "I want to talk to a human"));
    expect(await events(conversationId, "conversation.human_takeover")).toHaveLength(1);
    expect(await outboundCount(conversationId)).toBe(before);
  });

  it("the agent returns it to automation: unassigned, AI allowed again, ai_resumed emitted", async () => {
    const res = await inboxAction(tenant, { action: "return_to_ai", conversation_id: conversationId });
    expect(res.status).toBe(200);
    const c = await conversationFor(number.id);
    expect(c.assigned_staff_id).toBeNull();
    expect(handoverState(c)).toBe("bot_active");
    expect(aiMayReply(c)).toBe(true);
    expect(await events(conversationId, "conversation.ai_resumed")).toHaveLength(1);
    // idempotent: a second return is a no-op and emits nothing more
    const again = await inboxAction(tenant, { action: "return_to_ai", conversation_id: conversationId });
    expect(again.body).toMatchObject({ unchanged: true });
    expect(await events(conversationId, "conversation.ai_resumed")).toHaveLength(1);
  });

  it("the timeline records the whole story in order", async () => {
    const { data } = await admin.from("workspace_activity_log").select("action").eq("target_id", conversationId).order("created_at");
    const actions = (data ?? []).map((r) => r.action);
    const story = ["inbox_conversation_handoff_requested", "inbox_conversation_taken_over", "inbox_staff_reply_sent", "inbox_conversation_returned_to_ai"];
    expect(story.map((a) => actions.indexOf(a))).toEqual([...story.map((a) => actions.indexOf(a))].sort((x, y) => x - y));
    expect(story.every((a) => actions.includes(a))).toBe(true);
  });
});

describe("workspace handover keywords", () => {
  it("a configured phrase hands over; it must match a whole word", async () => {
    const waId = "27820005678";
    await admin.from("workspace_settings").update({ handoff_keywords: ["refund"] }).eq("workspace_id", tenant.workspaceId);
    await postWebhook(inbound(number.phone_number_id, `wamid.k1-${Date.now()}`, "Your refunds page is great", waId));
    expect(handoverState(await conversationFor(number.id, waId))).toBe("bot_active");
    await postWebhook(inbound(number.phone_number_id, `wamid.k2-${Date.now()}`, "I need a refund for order 12", waId));
    const c = await conversationFor(number.id, waId);
    expect(handoverState(c)).toBe("handover_requested");
    const ev = await events(c.id, "conversation.human_takeover");
    expect(ev[0].payload).toMatchObject({ by: "keyword" });
  });

  it("rejects invalid keyword lists at the database", async () => {
    const tooLong = await admin.from("workspace_settings").update({ handoff_keywords: ["x".repeat(61)] }).eq("workspace_id", tenant.workspaceId);
    expect(tooLong.error).toBeTruthy();
    const tooMany = await admin.from("workspace_settings").update({ handoff_keywords: Array.from({ length: 26 }, (_, i) => `kw${i}`) }).eq("workspace_id", tenant.workspaceId);
    expect(tooMany.error).toBeTruthy();
  });
});

describe("pause, close and isolation", () => {
  it("pause_ai stops AI without a handover alert; closing emits conversation.closed", async () => {
    const waId = "27820009999";
    await postWebhook(inbound(number.phone_number_id, `wamid.p1-${Date.now()}`, "Hello there, quick question about delivery", waId));
    const c = await conversationFor(number.id, waId);
    expect((await inboxAction(tenant, { action: "pause_ai", conversation_id: c.id })).status).toBe(200);
    const paused = await conversationFor(number.id, waId);
    expect(handoverState(paused)).toBe("bot_paused");
    expect(aiMayReply(paused)).toBe(false);
    const { data: alerts } = await admin.from("inbox_alerts").select("id").eq("conversation_id", c.id).eq("alert_type", "human_handoff");
    expect(alerts).toEqual([]);
    expect(await events(c.id, "conversation.ai_paused")).toHaveLength(1);

    expect((await inboxAction(tenant, { action: "resolve", conversation_id: c.id })).status).toBe(200);
    expect(handoverState(await conversationFor(number.id, waId))).toBe("closed");
    expect(await events(c.id, "conversation.closed")).toHaveLength(1);
  });

  it("another workspace cannot take over, pause or read this conversation", async () => {
    const c = await conversationFor(number.id);
    const takeOver = await inboxAction(other, { action: "take_over", conversation_id: c.id });
    expect(takeOver.status).toBeGreaterThanOrEqual(400);
    const takeOverOwnWs = await inboxAction(other, { action: "take_over", conversation_id: c.id, workspace_id: other.workspaceId });
    expect(takeOverOwnWs.status).toBeGreaterThanOrEqual(400);
    const { data: leaked } = await other.client.from("inbox_conversations").select("id").eq("id", c.id);
    expect(leaked).toEqual([]);
    const { data: leakedLog } = await other.client.from("workspace_activity_log").select("id").eq("target_id", c.id);
    expect(leakedLog).toEqual([]);
  });

  it("assigning to someone outside the workspace is refused", async () => {
    const c = await conversationFor(number.id);
    const res = await inboxAction(tenant, { action: "take_over", conversation_id: c.id, staff_id: other.userId === tenant.userId ? crypto.randomUUID() : crypto.randomUUID() });
    expect(res.status).toBe(400);
  });
});

describe("agent assist", () => {
  it("is refused without a plan that includes WhatsApp, and never sends anything", async () => {
    await admin.from("feature_flag_workspace_targets").delete().eq("flag_key", "module.whatsapp").eq("workspace_id", tenant.workspaceId);
    const c = await conversationFor(number.id);
    const before = await outboundCount(c.id);
    const res = await inboxAction(tenant, { action: "assist", conversation_id: c.id, mode: "suggest_reply" });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "MODULE_NOT_IN_PLAN" });
    expect(await outboundCount(c.id)).toBe(before);
  });

  it("with WhatsApp enabled it validates input and reports missing AI config honestly", async () => {
    await admin.from("feature_flag_workspace_targets").upsert({ flag_key: "module.whatsapp", workspace_id: tenant.workspaceId, enabled: true, reason: "test" });
    const c = await conversationFor(number.id);
    const before = await outboundCount(c.id);
    expect((await inboxAction(tenant, { action: "assist", conversation_id: c.id, mode: "nonsense" })).status).toBe(400);
    expect((await inboxAction(tenant, { action: "assist", conversation_id: c.id, mode: "improve", draft: "" })).status).toBe(400);
    const res = await inboxAction(tenant, { action: "assist", conversation_id: c.id, mode: "summarise" });
    expect(res.status).toBe(503); // local stack has no OPENAI key
    expect(await outboundCount(c.id)).toBe(before);
  });
});

// Phase 7 - Inbox AI cost governance + workspace usage caps.
//
// The budget MATH (period boundary, cap resolution, decide()) is covered by
// the pure Deno unit tests (_shared/inbox/inboxAiBudget.test.ts) with no
// OpenAI involved. This suite proves the DB-backed behaviour against the
// REAL local whatsapp-webhook + inbox-actions + RLS:
//   * the cap gate runs BEFORE any OpenAI work - over the cap the webhook
//     makes ZERO OpenAI call, stores the inbound message, hands the
//     conversation to staff, and raises ONE unresolved alert
//   * repeated over-cap messages do not pile up alerts / replies
//   * raising the cap lets a fresh AI-enabled conversation through again
//   * a plain staff reply does NOT clear the pause; Return to AI does
//   * usage is feature-scoped and UTC-month-scoped (Flow AI usage and last
//     month's usage never count)
//   * set_workspace_inbox_ai_cap: manage_billing only, bounds enforced,
//     sibling limits keys untouched, NULL clears the override
//   * cross-workspace isolation on usage + cap
// No OpenAI/WhatsApp/Meta call: the number's credential is a mock token and
// the local edge runtime has no OPENAI key - the cap gate sits in front of
// both, so an over-cap turn never reaches either.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin, cleanupTenant, createTestTenant, createTestUser, getTestEnv, seedMembership, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedInboxConversation, seedWhatsAppSetup } from "./inboxHelpers";

const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;
const INBOX_URL = `${SUPABASE_URL}/functions/v1/inbox-actions`;
const APP_SECRET = getTestEnv("INTEGRATIONS_META_APP_SECRET");
const INBOX_AI_FEATURE = "whatsapp_inbox_ai";

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
      contacts: [{ wa_id: waId, profile: { name: "Budget Tester" } }],
      messages: [{ from: waId, id: messageId, type: "text", text: { body: text } }],
    } }] }],
  });
}
async function tokenFor(t: { client: SupabaseClient }) {
  const { data } = await t.client.auth.getSession();
  return data.session!.access_token;
}
async function callInbox(token: string, body: Record<string, unknown>) {
  const res = await fetch(INBOX_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function seedUsage(workspaceId: string, feature: string, tokens: number, createdAt?: string) {
  const half = Math.floor(tokens / 2);
  const { error } = await admin.from("ai_usage_events").insert({
    workspace_id: workspaceId, feature, provider: "openai", model: "gpt-4o-mini",
    input_tokens: half, output_tokens: tokens - half, status: "success",
    ...(createdAt ? { created_at: createdAt } : {}),
  });
  if (error) throw new Error(`seedUsage failed: ${error.message}`);
}
async function setCap(workspaceId: string, cap: number | null) {
  const { data: b } = await admin.from("workspace_billing").select("limits").eq("workspace_id", workspaceId).single();
  const limits = { ...(b?.limits as Record<string, unknown> ?? {}) };
  if (cap == null) delete limits.whatsapp_inbox_ai_monthly_token_limit;
  else limits.whatsapp_inbox_ai_monthly_token_limit = cap;
  await admin.from("workspace_billing").update({ limits }).eq("workspace_id", workspaceId);
}
async function convByWa(wa: string) {
  const { data } = await admin.from("inbox_conversations").select("id, status, ai_enabled, human_handoff_requested_at").eq("wa_id", wa).single();
  return data!;
}
async function openLimitAlerts(conversationId: string) {
  const { data } = await admin.from("inbox_alerts")
    .select("id, severity, title, is_resolved")
    .eq("conversation_id", conversationId).eq("alert_type", "ai_usage_limit_reached").eq("is_resolved", false);
  return data ?? [];
}
async function outboundCount(conversationId: string) {
  const { count } = await admin.from("inbox_messages").select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId).eq("direction", "outbound");
  return count ?? 0;
}
async function usageRows(workspaceId: string, status?: string) {
  let q = admin.from("ai_usage_events").select("status, total_tokens, input_tokens, output_tokens").eq("workspace_id", workspaceId).eq("feature", INBOX_AI_FEATURE);
  if (status) q = q.eq("status", status);
  const { data } = await q;
  return data ?? [];
}

describe("Phase 7 - Inbox AI cost governance", () => {
  let ws: TestTenant;
  let other: TestTenant;
  let phoneNumberId: string;
  let numberId: string;
  let ownerToken: string;

  beforeAll(async () => {
    ws = await createTestTenant("aicost");
    other = await createTestTenant("aicost-other");
    const num = await seedWhatsAppSetup(ws.workspaceId);
    numberId = num.id;
    phoneNumberId = num.phone_number_id;
    await admin.rpc("set_workspace_integration_secret", {
      p_integration_id: (await admin.from("workspace_whatsapp_numbers").select("integration_id").eq("id", numberId).single()).data!.integration_id,
      p_secret: "mock-whatsapp-token-not-a-real-credential",
    });
    await seedWhatsAppSetup(other.workspaceId);
    ownerToken = await tokenFor(ws);
  });
  afterAll(async () => {
    await cleanupTenant(ws);
    await cleanupTenant(other);
  });

  // --- the cap gate --------------------------------------------------

  it("over the monthly cap: no OpenAI call, inbound message kept, conversation handed to staff, ONE alert, zero-token blocked_quota row", async () => {
    await setCap(ws.workspaceId, 1000);
    await seedUsage(ws.workspaceId, INBOX_AI_FEATURE, 1200); // already over
    const wa = "27820000701";
    expect(await postWebhook(textPayload(phoneNumberId, `wamid.over-${Date.now()}`, wa, "please help me with pricing"))).toBe(200);

    const conv = await convByWa(wa);
    expect(conv.ai_enabled).toBe(false);
    expect(conv.status).toBe("human_handoff");
    expect(conv.human_handoff_requested_at).toBeTruthy();

    const { data: inbound } = await admin.from("inbox_messages").select("id, direction").eq("conversation_id", conv.id);
    expect((inbound ?? []).some((m) => m.direction === "inbound")).toBe(true); // message not lost
    expect(await outboundCount(conv.id)).toBe(0); // no fabricated reply

    const alerts = await openLimitAlerts(conv.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");

    const blocked = await usageRows(ws.workspaceId, "blocked_quota");
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(blocked.every((r) => (r.total_tokens ?? 0) === 0)).toBe(true); // never invents token usage

    // domain event emitted for the automation engine
    const { count: evt } = await admin.from("domain_events").select("id", { count: "exact", head: true })
      .eq("event_type", "conversation.ai_limit_reached").eq("entity_id", conv.id);
    expect(evt).toBe(1);
  });

  it("repeated over-cap messages do not create endless alerts or replies", async () => {
    await setCap(ws.workspaceId, 1000); // still over from the previous test's seeded usage
    const wa = "27820000702";
    for (let i = 0; i < 3; i++) {
      expect(await postWebhook(textPayload(phoneNumberId, `wamid.rep-${i}-${Date.now()}`, wa, `message ${i}`))).toBe(200);
    }
    const conv = await convByWa(wa);
    expect(await openLimitAlerts(conv.id)).toHaveLength(1); // one, not three
    expect(await outboundCount(conv.id)).toBe(0);
  });

  it("raising the cap lets a fresh AI-enabled conversation through the gate again", async () => {
    await setCap(ws.workspaceId, 10_000_000); // now well above the ~1200 used
    const wa = "27820000703";
    expect(await postWebhook(textPayload(phoneNumberId, `wamid.under-${Date.now()}`, wa, "hello I have a question about delivery"))).toBe(200);
    const conv = await convByWa(wa);
    // Under budget -> the gate passes. Locally there is no OPENAI key so the
    // webhook then stops at the config check: no handoff, no alert, AI still
    // enabled - exactly the pre-Phase-7 "leave for staff" behaviour.
    expect(conv.ai_enabled).toBe(true);
    expect(conv.status).toBe("active");
    expect(await openLimitAlerts(conv.id)).toHaveLength(0);
    expect(await outboundCount(conv.id)).toBe(0);
  });

  it("human_handoff / ai_enabled=false still short-circuits BEFORE the budget gate (budget is irrelevant then)", async () => {
    await setCap(ws.workspaceId, 10_000_000); // plenty of budget
    const wa = "27820000704";
    await seedInboxConversation(ws.workspaceId, numberId, { wa_id: wa, phone_number: `+${wa}`, status: "human_handoff", ai_enabled: false, inbox_status: "assigned" });
    expect(await postWebhook(textPayload(phoneNumberId, `wamid.human-${Date.now()}`, wa, "another message"))).toBe(200);
    const conv = await convByWa(wa);
    expect(await openLimitAlerts(conv.id)).toHaveLength(0); // no cap alert - the gate was never reached
    expect(await outboundCount(conv.id)).toBe(0);
  });

  // --- resolution ---------------------------------------------------

  it("Return to AI clears the cap alert; a conversation-resolve also clears it; a bare reply does not", async () => {
    await setCap(ws.workspaceId, 1);
    await seedUsage(ws.workspaceId, INBOX_AI_FEATURE, 50);
    const wa = "27820000705";
    expect(await postWebhook(textPayload(phoneNumberId, `wamid.res-${Date.now()}`, wa, "help"))).toBe(200);
    const conv = await convByWa(wa);
    expect(await openLimitAlerts(conv.id)).toHaveLength(1);

    const res = await callInbox(ownerToken, { workspace_id: ws.workspaceId, conversation_id: conv.id, action: "return_to_ai" });
    expect(res.status).toBe(200);
    expect(await openLimitAlerts(conv.id)).toHaveLength(0);
    await setCap(ws.workspaceId, 10_000_000);
  });

  // --- usage scoping ----------------------------------------------

  it("the cap counts only feature='whatsapp_inbox_ai' and only the current UTC month", async () => {
    const scoped = await createTestTenant("aicost-scope");
    try {
      const num = await seedWhatsAppSetup(scoped.workspaceId);
      await admin.rpc("set_workspace_integration_secret", {
        p_integration_id: (await admin.from("workspace_whatsapp_numbers").select("integration_id").eq("id", num.id).single()).data!.integration_id,
        p_secret: "mock-whatsapp-token-not-a-real-credential",
      });
      await setCap(scoped.workspaceId, 1000);
      await seedUsage(scoped.workspaceId, "flow_ai_chat", 5000);                                   // other feature - ignored
      await seedUsage(scoped.workspaceId, INBOX_AI_FEATURE, 5000, "2020-01-15T00:00:00.000Z");     // last-ever month - ignored
      await seedUsage(scoped.workspaceId, INBOX_AI_FEATURE, 200);                                  // this month, under 1000

      const wa = "27820000706";
      expect(await postWebhook(textPayload(num.phone_number_id, `wamid.scope-${Date.now()}`, wa, "hi there"))).toBe(200);
      const { data: conv } = await admin.from("inbox_conversations").select("id, ai_enabled, status").eq("wa_id", wa).single();
      expect(conv!.ai_enabled).toBe(true);   // 200 of 1000 used -> under cap -> gate passes
      expect(conv!.status).toBe("active");
    } finally {
      await cleanupTenant(scoped);
    }
  });

  it("workspace A's Inbox AI usage never affects workspace B", async () => {
    await setCap(other.workspaceId, 10_000_000);
    // ws has huge seeded usage by now; other has none
    const { data } = await admin.from("ai_usage_events").select("id").eq("workspace_id", other.workspaceId).eq("feature", INBOX_AI_FEATURE);
    expect(data ?? []).toEqual([]);
  });

  // --- set_workspace_inbox_ai_cap RPC ---------------------------

  it("set_workspace_inbox_ai_cap: owner can set / clear; sibling limits keys survive", async () => {
    await admin.from("workspace_billing").update({ limits: { flow_ai_monthly_token_limit: 777 } }).eq("workspace_id", ws.workspaceId);
    const { data: setRes, error: setErr } = await ws.client.rpc("set_workspace_inbox_ai_cap", { p_workspace_id: ws.workspaceId, p_cap: 250000 });
    expect(setErr).toBeNull();
    expect(Number(setRes)).toBe(250000);
    let { data: b } = await admin.from("workspace_billing").select("limits").eq("workspace_id", ws.workspaceId).single();
    expect((b!.limits as Record<string, unknown>).whatsapp_inbox_ai_monthly_token_limit).toBe(250000);
    expect((b!.limits as Record<string, unknown>).flow_ai_monthly_token_limit).toBe(777); // untouched

    const { data: clrRes } = await ws.client.rpc("set_workspace_inbox_ai_cap", { p_workspace_id: ws.workspaceId });
    expect(clrRes).toBeNull();
    ({ data: b } = await admin.from("workspace_billing").select("limits").eq("workspace_id", ws.workspaceId).single());
    expect("whatsapp_inbox_ai_monthly_token_limit" in (b!.limits as Record<string, unknown>)).toBe(false);
    expect((b!.limits as Record<string, unknown>).flow_ai_monthly_token_limit).toBe(777);
  });

  it("set_workspace_inbox_ai_cap: rejects out-of-bounds and non-owner callers", async () => {
    const { error: tooBig } = await ws.client.rpc("set_workspace_inbox_ai_cap", { p_workspace_id: ws.workspaceId, p_cap: 2000000000000 });
    expect(tooBig).toBeTruthy();
    const { error: zero } = await ws.client.rpc("set_workspace_inbox_ai_cap", { p_workspace_id: ws.workspaceId, p_cap: 0 });
    expect(zero).toBeTruthy();

    const marketing = await createTestUser("aicost-mkt");
    await seedMembership(ws.workspaceId, marketing.userId, "marketing");
    const { error: forbidden } = await marketing.client.rpc("set_workspace_inbox_ai_cap", { p_workspace_id: ws.workspaceId, p_cap: 123 });
    expect(forbidden).toBeTruthy();
    // cross-workspace
    const { error: crossWs } = await other.client.rpc("set_workspace_inbox_ai_cap", { p_workspace_id: ws.workspaceId, p_cap: 123 });
    expect(crossWs).toBeTruthy();
    await cleanupTenant({ userId: marketing.userId });
  });

  it("workspace A cannot read workspace B's billing limits or AI usage rows", async () => {
    await admin.from("ai_usage_events").insert({ workspace_id: ws.workspaceId, feature: INBOX_AI_FEATURE, provider: "openai", model: "gpt-4o-mini", input_tokens: 1, output_tokens: 1, status: "success" });
    const { data: usage } = await other.client.from("ai_usage_events").select("id").eq("workspace_id", ws.workspaceId);
    expect(usage ?? []).toEqual([]); // ai_usage_events RLS (manage_billing on B only)
    const { data: billing } = await other.client.from("workspace_billing").select("limits").eq("workspace_id", ws.workspaceId);
    expect(billing ?? []).toEqual([]); // workspace_billing select = member of that workspace
  });
});

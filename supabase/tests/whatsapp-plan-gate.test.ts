// Free-plan bypass fix: connecting Meta/WhatsApp and WhatsApp AI replies
// are plan-gated server-side, not only by the Integrations/WhatsApp route
// FeatureGates. Runs against the REAL local integrations-oauth-start and
// whatsapp-webhook functions with real RLS.
//
// - integrations-oauth-start: Meta needs module.integrations; WhatsApp needs
//   module.integrations AND module.whatsapp. Non-members get a plain
//   Forbidden (no plan details).
// - whatsapp-webhook: a workspace without module.whatsapp still has its
//   inbound messages stored and handover handled, but never enters the AI
//   path - no AI budget lookup, no whatsapp_ai_turns reserved, no alert.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, enableModules, getTestEnv, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedWhatsAppSetup } from "./inboxHelpers";

const TEST_HARNESS_SECRET = getTestEnv("INTEGRATIONS_TEST_HARNESS_SECRET");
const APP_SECRET = getTestEnv("INTEGRATIONS_META_APP_SECRET");
const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;
const INBOX_AI_FEATURE = "whatsapp_inbox_ai";

async function tokenFor(t: { client: SupabaseClient }) {
  const { data } = await t.client.auth.getSession();
  return data.session!.access_token;
}

async function startOauth(token: string, workspaceId: string, provider: "meta" | "whatsapp") {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/integrations-oauth-start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "x-stabiflow-test-harness": TEST_HARNESS_SECRET },
    body: JSON.stringify({ workspace_id: workspaceId, provider }),
  });
  return { status: res.status, body: await res.json() };
}

async function oauthStateCount(workspaceId: string) {
  const { count } = await admin.from("workspace_integration_oauth_states").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
  return count ?? 0;
}

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return "sha256=" + [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function postText(phoneNumberId: string, waId: string, text: string) {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "waba", changes: [{ field: "messages", value: {
      metadata: { phone_number_id: phoneNumberId },
      contacts: [{ wa_id: waId, profile: { name: "Plan Gate Tester" } }],
      messages: [{ from: waId, id: `wamid.gate-${waId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type: "text", text: { body: text } }],
    } }] }],
  });
  const res = await fetch(WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json", "x-hub-signature-256": await sign(body) }, body });
  return res.status;
}

const period = () => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);

async function aiTurnsUsed(workspaceId: string) {
  const { data } = await admin.from("entitlement_usage").select("used").eq("workspace_id", workspaceId).eq("entitlement_key", "whatsapp_ai_turns").eq("period_start", period()).maybeSingle();
  return Number(data?.used ?? 0);
}

async function conversationFor(waId: string) {
  const { data } = await admin.from("inbox_conversations").select("id, status, ai_enabled").eq("wa_id", waId).single();
  return data!;
}

async function inboundMessages(conversationId: string) {
  const { data } = await admin.from("inbox_messages").select("id, content").eq("conversation_id", conversationId).eq("direction", "inbound");
  return data ?? [];
}

async function aiUsageRows(workspaceId: string) {
  const { data } = await admin.from("ai_usage_events").select("status").eq("workspace_id", workspaceId).eq("feature", INBOX_AI_FEATURE);
  return data ?? [];
}

async function limitAlerts(conversationId: string) {
  const { data } = await admin.from("inbox_alerts").select("id").eq("conversation_id", conversationId).eq("alert_type", "ai_usage_limit_reached");
  return data ?? [];
}

// Puts the workspace over its Inbox AI cap: if the webhook enters the AI
// path at all, the budget gate then records a zero-token blocked_quota row,
// raises an alert and hands the chat to staff - observable proof that the
// AI path ran, without needing a real model call.
async function putOverAiCap(workspaceId: string) {
  const { data: b } = await admin.from("workspace_billing").select("limits").eq("workspace_id", workspaceId).single();
  await admin.from("workspace_billing").update({ limits: { ...(b?.limits as Record<string, unknown> ?? {}), whatsapp_inbox_ai_monthly_token_limit: 1000 } }).eq("workspace_id", workspaceId);
  await admin.from("ai_usage_events").insert({ workspace_id: workspaceId, feature: INBOX_AI_FEATURE, provider: "openai", model: "gpt-4o-mini", input_tokens: 600, output_tokens: 600, status: "success" });
}

describe("integrations-oauth-start plan gate", () => {
  let free: TestTenant;
  let integrationsOnly: TestTenant;
  let growth: TestTenant;

  beforeAll(async () => {
    free = await createTestTenant("oauth-gate-free");
    integrationsOnly = await createTestTenant("oauth-gate-integrations");
    await enableModules(integrationsOnly.workspaceId, "module.integrations");
    growth = await createTestTenant("oauth-gate-growth");
    await enableModules(growth.workspaceId, "module.integrations", "module.whatsapp");
  });

  afterAll(async () => {
    await cleanupTenant(free);
    await cleanupTenant(integrationsOnly);
    await cleanupTenant(growth);
  });

  it("refuses a Free workspace a WhatsApp authorize URL and mints no state", async () => {
    const r = await startOauth(await tokenFor(free), free.workspaceId, "whatsapp");
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("MODULE_NOT_IN_PLAN");
    expect(r.body.error).toMatch(/WhatsApp is part of the Growth plan/);
    expect(r.body.url).toBeUndefined();
    expect(await oauthStateCount(free.workspaceId)).toBe(0);
  });

  it("refuses a Free workspace a Meta (Facebook/Instagram) authorize URL", async () => {
    const r = await startOauth(await tokenFor(free), free.workspaceId, "meta");
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("MODULE_NOT_IN_PLAN");
    expect(r.body.error).toMatch(/Facebook and Instagram connections are part of the Growth plan/);
    expect(await oauthStateCount(free.workspaceId)).toBe(0);
  });

  it("WhatsApp needs module.whatsapp as well as module.integrations", async () => {
    const token = await tokenFor(integrationsOnly);
    const wa = await startOauth(token, integrationsOnly.workspaceId, "whatsapp");
    expect(wa.status).toBe(403);
    expect(wa.body.code).toBe("MODULE_NOT_IN_PLAN");
    const meta = await startOauth(token, integrationsOnly.workspaceId, "meta");
    expect(meta.status).toBe(200);
    expect(meta.body.url).toBeTruthy();
  });

  it("a Growth-enabled workspace still gets authorize URLs for both providers", async () => {
    const token = await tokenFor(growth);
    for (const provider of ["whatsapp", "meta"] as const) {
      const r = await startOauth(token, growth.workspaceId, provider);
      expect(r.status).toBe(200);
      expect(new URL(r.body.url).searchParams.get("state")).toBeTruthy();
    }
    expect(await oauthStateCount(growth.workspaceId)).toBe(2);
  });

  it("another workspace gets a plain Forbidden with no plan details", async () => {
    for (const provider of ["whatsapp", "meta"] as const) {
      const r = await startOauth(await tokenFor(free), growth.workspaceId, provider);
      expect(r.status).toBe(403);
      expect(r.body).toEqual({ error: "Forbidden" });
    }
  });
});

describe("whatsapp-webhook AI plan gate", () => {
  let disabled: TestTenant;
  let enabled: TestTenant;
  let disabledPhone: string;
  let enabledPhone: string;

  beforeAll(async () => {
    disabled = await createTestTenant("wa-gate-disabled");
    enabled = await createTestTenant("wa-gate-enabled");
    await enableModules(enabled.workspaceId, "module.whatsapp");
    // A working send credential, as on a connected number: without one the
    // webhook stops before both the handover and the AI paths.
    for (const t of [disabled, enabled]) {
      const number = await seedWhatsAppSetup(t.workspaceId);
      const { data: row } = await admin.from("workspace_whatsapp_numbers").select("integration_id").eq("id", number.id).single();
      await admin.rpc("set_workspace_integration_secret", { p_integration_id: row!.integration_id, p_secret: "mock-whatsapp-token-not-a-real-credential" });
      if (t === disabled) disabledPhone = number.phone_number_id;
      else enabledPhone = number.phone_number_id;
    }
  });

  afterAll(async () => {
    await cleanupTenant(disabled);
    await cleanupTenant(enabled);
  });

  it("stores the inbound message but reserves no whatsapp_ai_turns on a workspace without WhatsApp", async () => {
    const before = await aiTurnsUsed(disabled.workspaceId);
    const wa = "27820009001";
    expect(await postText(disabledPhone, wa, "Do you deliver to Umhlanga on Saturdays?")).toBe(200);
    const conv = await conversationFor(wa);
    const inbound = await inboundMessages(conv.id);
    expect(inbound).toHaveLength(1);
    expect(inbound[0].content).toBe("Do you deliver to Umhlanga on Saturdays?");
    expect(conv.status).toBe("active");
    expect(conv.ai_enabled).toBe(true);
    expect(await aiTurnsUsed(disabled.workspaceId)).toBe(before);
  });

  it("never enters the AI path on a workspace without WhatsApp (no budget check, no alert, no usage row)", async () => {
    await putOverAiCap(disabled.workspaceId);
    const wa = "27820009002";
    expect(await postText(disabledPhone, wa, "What are your prices?")).toBe(200);
    const conv = await conversationFor(wa);
    expect(await inboundMessages(conv.id)).toHaveLength(1);
    expect(await limitAlerts(conv.id)).toHaveLength(0);
    expect((await aiUsageRows(disabled.workspaceId)).filter((r) => r.status === "blocked_quota")).toHaveLength(0);
    expect(conv.status).toBe("active");
  });

  it("still hands over to a person when asked, without WhatsApp AI", async () => {
    const wa = "27820009003";
    expect(await postText(disabledPhone, wa, "talk to a human")).toBe(200);
    const conv = await conversationFor(wa);
    expect(conv.status).toBe("human_handoff");
    expect(await inboundMessages(conv.id)).toHaveLength(1);
  });

  it("an enabled workspace still reserves an AI reply turn as before", async () => {
    const before = await aiTurnsUsed(enabled.workspaceId);
    const wa = "27820009004";
    expect(await postText(enabledPhone, wa, "Do you deliver to Umhlanga on Saturdays?")).toBe(200);
    const conv = await conversationFor(wa);
    expect(await inboundMessages(conv.id)).toHaveLength(1);
    expect(await aiTurnsUsed(enabled.workspaceId)).toBe(before + 1);
  });

  it("an enabled workspace still enters the AI path (over-cap gate fires as before)", async () => {
    await putOverAiCap(enabled.workspaceId);
    const wa = "27820009005";
    expect(await postText(enabledPhone, wa, "What are your prices?")).toBe(200);
    const conv = await conversationFor(wa);
    expect(conv.status).toBe("human_handoff");
    expect(await limitAlerts(conv.id)).toHaveLength(1);
    expect((await aiUsageRows(enabled.workspaceId)).some((r) => r.status === "blocked_quota")).toBe(true);
  });
});

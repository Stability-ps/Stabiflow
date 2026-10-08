// 20261027080000_gate_paid_analytics_reads. Product policy: on downgrade the
// workspace KEEPS its historical data, but paid analytics read models are
// unavailable until it upgrades again - enforced server-side, not just by
// the route gate. Runs against LOCAL Supabase with real RLS.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, enableModules, type TestTenant } from "./helpers";

const PLAN_MSG = /Analytics is part of the Growth plan/;
const WA_MSG = /WhatsApp is part of the Growth plan/;
const range = { p_date_from: new Date(Date.now() - 30 * 86_400_000).toISOString(), p_date_to: new Date().toISOString() };
const NIL = "00000000-0000-0000-0000-000000000000";

let ws: TestTenant;
let outsider: TestTenant;

async function setModules(on: string[]) {
  await admin.from("feature_flag_workspace_targets").delete().eq("workspace_id", ws.workspaceId);
  if (on.length) await enableModules(ws.workspaceId, ...on);
}
const call = (fn: string, args: Record<string, unknown>, who: TestTenant = ws) => who.client.rpc(fn, { p_workspace_id: ws.workspaceId, ...args });

const ANALYTICS_ONLY: Array<[string, Record<string, unknown>]> = [
  ["get_creative_performance", { ...range, p_attribution_model: "last_touch" }],
  ["get_lead_source_breakdown", range],
  ["get_whatsapp_analytics", range],
  ["get_revenue_breakdown", range],
];
const CAMPAIGN_READS: Array<[string, Record<string, unknown>]> = [
  ["get_campaign_performance", { ...range, p_attribution_model: "last_touch" }],
  ["get_campaign_journey", { p_campaign_id: NIL, p_attribution_model: "last_touch" }],
  ["get_campaign_journey_entities", { p_campaign_id: NIL, p_stage: "lead", p_attribution_model: "last_touch", p_limit: 10, p_offset: 0 }],
  ["get_campaign_conversion_counts", { p_campaign_id: NIL }],
];

beforeAll(async () => {
  ws = await createTestTenant("analytics-gate");
  outsider = await createTestTenant("analytics-gate-outsider");
});
afterAll(async () => { await cleanupTenant(ws); await cleanupTenant(outsider); });

describe("paid analytics read models follow the plan", () => {
  it("Free (no modules): every analytics read model refuses the workspace's own member", async () => {
    await setModules([]);
    for (const [fn, args] of [...ANALYTICS_ONLY, ...CAMPAIGN_READS]) {
      const { error } = await call(fn, args);
      expect(error?.code, fn).toBe("42501");
      expect(error?.message, fn).toMatch(PLAN_MSG);
    }
    const { error } = await call("get_whatsapp_operational_analytics", range);
    expect(error?.message).toMatch(WA_MSG);
  });

  it("Home's baseline KPIs stay available on every plan", async () => {
    await setModules([]);
    const { error } = await call("get_analytics_kpis", range);
    expect(error).toBeNull();
  });

  it("with Analytics: every analytics read model works", async () => {
    await setModules(["module.analytics"]);
    for (const [fn, args] of [...ANALYTICS_ONLY, ...CAMPAIGN_READS]) {
      const { error } = await call(fn, args);
      expect(error, fn).toBeNull();
    }
  });

  it("Campaigns without Analytics: campaign read models work, analytics-only ones do not", async () => {
    await setModules(["module.campaigns"]);
    for (const [fn, args] of CAMPAIGN_READS) expect((await call(fn, args)).error, fn).toBeNull();
    for (const [fn, args] of ANALYTICS_ONLY) expect((await call(fn, args)).error?.message, fn).toMatch(PLAN_MSG);
  });

  it("WhatsApp operational analytics follow the WhatsApp module", async () => {
    await setModules(["module.whatsapp"]);
    expect((await call("get_whatsapp_operational_analytics", range)).error).toBeNull();
  });

  it("a non-member still gets the original answer (an empty result), never the plan message", async () => {
    await setModules([]);
    const { data, error } = await call("get_lead_source_breakdown", range, outsider);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("the un-gated originals are not callable through the API", async () => {
    const { error } = await ws.client.rpc("_get_lead_source_breakdown_ungated", { p_workspace_id: ws.workspaceId, ...range });
    expect(error).not.toBeNull();
  });
});

describe("downgrade keeps creator campaign history but hides it until upgrade", () => {
  it("rows survive a downgrade, are hidden without Analytics, and return on upgrade", async () => {
    await setModules(["module.analytics"]);
    const { data: created, error } = await ws.client.from("creator_campaigns")
      .insert({ workspace_id: ws.workspaceId, name: "History", creator_name: "Kept", platform: "instagram", created_by: ws.userId })
      .select("id").single();
    expect(error).toBeNull();

    await setModules([]); // downgrade
    const { data: hidden } = await ws.client.from("creator_campaigns").select("id").eq("id", created!.id);
    expect(hidden).toEqual([]);
    const { count } = await admin.from("creator_campaigns").select("id", { count: "exact", head: true }).eq("id", created!.id);
    expect(count).toBe(1); // never deleted

    await setModules(["module.analytics"]); // upgrade again
    const { data: back } = await ws.client.from("creator_campaigns").select("id").eq("id", created!.id);
    expect(back).toHaveLength(1);
  });
});

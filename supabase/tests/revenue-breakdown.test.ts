// Phase 1 (Revenue Operations) - get_revenue_breakdown().
//
// Proves the read model directly against the real linked schema, called
// through real authenticated test-tenant sessions (never service-role -
// the RPC requires a real caller with view_analytics AND revenue.view).
//
// ONE call returns all three dimensions (dimension column): source /
// assist / day. A fixed historical window is used so date filtering is
// deterministic.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin, cleanupTenant, createTestTenant, createTestUser, seedMembership, type TestTenant } from "./helpers";
import { seedWhatsAppSetup, seedInboxConversation, seedInboxMessage } from "./inboxHelpers";
import { seedLead } from "./leadsHelpers";

const RANGE_FROM = "2024-06-01T00:00:00.000Z";
const RANGE_TO = "2024-07-01T00:00:00.000Z";
const IN_RANGE = "2024-06-15T12:00:00.000Z";
const AFTER_RANGE = "2024-08-15T12:00:00.000Z";

async function seedRevenue(workspaceId: string, cols: Record<string, unknown>) {
  const { data, error } = await admin
    .from("revenue_events")
    .insert({ workspace_id: workspaceId, amount_minor: 100000, currency: "ZAR", event_type: "sale", occurred_at: IN_RANGE, ...cols })
    .select("id").single();
  if (error) throw new Error(`seedRevenue failed: ${error.message}`);
  return data!.id as string;
}
async function seedAttribution(workspaceId: string, cols: Record<string, unknown>) {
  const { error } = await admin.from("attribution_events").insert({
    workspace_id: workspaceId, event_type: "touchpoint", occurred_at: IN_RANGE, platform: "meta", ...cols,
  });
  if (error) throw new Error(`seedAttribution failed: ${error.message}`);
}

function rows(data: unknown, dimension: string) {
  return ((data ?? []) as Array<{ dimension: string; bucket_key: string; revenue: Array<{ currency: string; amount_minor: number }>; event_count: number }>)
    .filter((r) => r.dimension === dimension);
}

describe("get_revenue_breakdown (Phase 1 remediation)", () => {
  let workspace: TestTenant;
  let otherWorkspace: TestTenant;
  let supportClient: SupabaseClient; // support lacks view_analytics

  beforeAll(async () => {
    workspace = await createTestTenant("rev-breakdown");
    otherWorkspace = await createTestTenant("rev-breakdown-other");

    const support = await createTestUser("rev-breakdown-support");
    await seedMembership(workspace.workspaceId, support.userId, "support");
    supportClient = support.client;

    const number = await seedWhatsAppSetup(workspace.workspaceId);

    // AI-only journey: AI outbound, no human evidence.
    const aiConv = await seedInboxConversation(workspace.workspaceId, number.id, { wa_id: "27820000001" });
    await seedInboxMessage(workspace.workspaceId, aiConv.id, { direction: "outbound", sender_type: "ai", content: "Hi" });
    const aiLead = (await seedLead(workspace.workspaceId, { created_from_conversation_id: aiConv.id, source: "meta" })).id;
    await seedAttribution(workspace.workspaceId, { lead_id: aiLead, conversation_id: aiConv.id, source_type: "paid", attribution_method: "deterministic", attribution_confidence: "exact", campaign_id: null });
    await seedRevenue(workspace.workspaceId, { lead_id: aiLead, amount_minor: 500000 });

    // AI + Human: AI outbound AND a staff outbound.
    const bothConv = await seedInboxConversation(workspace.workspaceId, number.id, { wa_id: "27820000002" });
    await seedInboxMessage(workspace.workspaceId, bothConv.id, { direction: "outbound", sender_type: "ai", content: "Hi" });
    await seedInboxMessage(workspace.workspaceId, bothConv.id, { direction: "outbound", sender_type: "staff", content: "Following up" });
    const bothLead = (await seedLead(workspace.workspaceId, { created_from_conversation_id: bothConv.id, source: "whatsapp" })).id;
    await seedAttribution(workspace.workspaceId, { lead_id: bothLead, conversation_id: bothConv.id, source_type: "direct", attribution_method: "deterministic", attribution_confidence: "exact" });
    await seedRevenue(workspace.workspaceId, { lead_id: bothLead, amount_minor: 200000 });

    // Human-only: staff outbound, NO AI outbound.
    const humanConv = await seedInboxConversation(workspace.workspaceId, number.id, { wa_id: "27820000003" });
    await seedInboxMessage(workspace.workspaceId, humanConv.id, { direction: "outbound", sender_type: "staff", content: "Hello" });
    const humanLead = (await seedLead(workspace.workspaceId, { created_from_conversation_id: humanConv.id, source: "whatsapp" })).id;
    await seedRevenue(workspace.workspaceId, { lead_id: humanLead, amount_minor: 150000 });

    // No conversation + no attribution.
    const bareLead = (await seedLead(workspace.workspaceId, { source: "manual" })).id;
    await seedRevenue(workspace.workspaceId, { lead_id: bareLead, amount_minor: 100000 });
    // Out of range - must never appear.
    await seedRevenue(workspace.workspaceId, { lead_id: bareLead, amount_minor: 999999, occurred_at: AFTER_RANGE });

    // The OTHER workspace's revenue must never leak.
    await seedRevenue(otherWorkspace.workspaceId, { lead_id: (await seedLead(otherWorkspace.workspaceId, { source: "manual" })).id, amount_minor: 424242 });
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
    await cleanupTenant(otherWorkspace);
  });

  async function call(client: SupabaseClient, workspaceId: string) {
    return client.rpc("get_revenue_breakdown", { p_workspace_id: workspaceId, p_date_from: RANGE_FROM, p_date_to: RANGE_TO });
  }

  it("REGRESSION: workspace A's owner cannot read workspace B's revenue - fully isolated", async () => {
    const { data } = await call(workspace.client, otherWorkspace.workspaceId);
    expect(data ?? []).toEqual([]);
  });

  it("a member without view_analytics (support) gets an empty result, not an error", async () => {
    const { data, error } = await call(supportClient, workspace.workspaceId);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("dimension=source: paid-but-unmatched -> meta_inferred; direct source_type -> whatsapp_direct; no evidence -> unattributed; out-of-range excluded", async () => {
    const { data, error } = await call(workspace.client, workspace.workspaceId);
    expect(error).toBeNull();
    const byKey = Object.fromEntries(rows(data, "source").map((r) => [r.bucket_key, r]));
    // aiLead: source_type='paid' but campaign_id null -> NOT meta_direct, it is meta_inferred (evidence a paid ad was involved, not campaign-attributed).
    expect(byKey.meta_inferred?.revenue?.[0]).toMatchObject({ currency: "ZAR", amount_minor: 500000 });
    // bothLead: source_type='direct' -> whatsapp_direct.
    expect(byKey.whatsapp_direct?.revenue?.[0]).toMatchObject({ currency: "ZAR", amount_minor: 200000 });
    // humanLead + bareLead have no attribution_events at all -> unattributed.
    expect(byKey.unattributed?.revenue?.[0]?.amount_minor).toBe(250000);
    expect(byKey.meta_direct).toBeUndefined();
    const total = rows(data, "source").reduce((s, r) => s + Number(r.event_count), 0);
    expect(total).toBe(4);
  });

  it("dimension=assist: ai_only / ai_and_human / human_only / no_conversation are all distinguished (audit HIGH-2)", async () => {
    const { data } = await call(workspace.client, workspace.workspaceId);
    const byKey = Object.fromEntries(rows(data, "assist").map((r) => [r.bucket_key, r]));
    expect(byKey.ai_only?.revenue?.[0]?.amount_minor).toBe(500000);
    expect(byKey.ai_and_human?.revenue?.[0]?.amount_minor).toBe(200000);
    expect(byKey.human_only?.revenue?.[0]?.amount_minor).toBe(150000);
    expect(byKey.no_conversation?.revenue?.[0]?.amount_minor).toBe(100000);
  });

  it("dimension=day: one bucket per calendar day with recorded revenue, in range only", async () => {
    const { data } = await call(workspace.client, workspace.workspaceId);
    const day = rows(data, "day");
    expect(day).toHaveLength(1);
    expect(day[0].bucket_key).toBe("2024-06-15");
    expect(day[0].revenue[0].amount_minor).toBe(950000); // 500k + 200k + 150k + 100k
  });

  it("an empty range returns no rows (a real 'no revenue', never a fabricated zero row)", async () => {
    const { data, error } = await workspace.client.rpc("get_revenue_breakdown", {
      p_workspace_id: workspace.workspaceId, p_date_from: "2020-01-01T00:00:00.000Z", p_date_to: "2020-02-01T00:00:00.000Z",
    });
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});

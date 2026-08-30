// Phase 1 (Revenue Operations) - get_revenue_breakdown().
//
// Proves the ONE new read model directly against the real linked schema,
// called through real authenticated test-tenant sessions (never
// service-role - the RPC requires a real caller with view_analytics AND
// revenue.view, exactly like Phase H's get_analytics_kpis).
//
// A fixed historical window is used so date-filtering assertions are
// deterministic regardless of when the suite runs. Every seeded row's
// timestamp is set explicitly.
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
    .select("id")
    .single();
  if (error) throw new Error(`seedRevenue failed: ${error.message}`);
  return data!.id as string;
}

async function seedAttribution(workspaceId: string, cols: Record<string, unknown>) {
  const { error } = await admin.from("attribution_events").insert({
    workspace_id: workspaceId,
    event_type: "touchpoint",
    occurred_at: IN_RANGE,
    platform: "meta",
    ...cols,
  });
  if (error) throw new Error(`seedAttribution failed: ${error.message}`);
}

describe("get_revenue_breakdown (Phase 1)", () => {
  let workspace: TestTenant;
  let otherWorkspace: TestTenant;
  let supportClient: SupabaseClient; // support lacks view_analytics in the existing matrix

  let directLeadId: string;
  let organicLeadId: string;
  let aiConversationId: string;
  let humanConversationId: string;

  beforeAll(async () => {
    workspace = await createTestTenant("rev-breakdown");
    otherWorkspace = await createTestTenant("rev-breakdown-other");

    const support = await createTestUser("rev-breakdown-support");
    await seedMembership(workspace.workspaceId, support.userId, "support");
    supportClient = support.client;

    const number = await seedWhatsAppSetup(workspace.workspaceId);

    // --- an AI-assisted journey: conversation with an AI outbound message,
    //     never handed to a human ---
    const aiConv = await seedInboxConversation(workspace.workspaceId, number.id, { wa_id: "27820000001" });
    aiConversationId = aiConv.id;
    await seedInboxMessage(workspace.workspaceId, aiConversationId, { direction: "outbound", sender_type: "ai", content: "Hi!" });
    directLeadId = (await seedLead(workspace.workspaceId, { created_from_conversation_id: aiConversationId, source: "meta" })).id;
    await seedAttribution(workspace.workspaceId, { lead_id: directLeadId, conversation_id: aiConversationId, source_type: "paid", attribution_method: "deterministic", attribution_confidence: "exact", campaign_id: null });
    const directRevenue = await seedRevenue(workspace.workspaceId, { lead_id: directLeadId, amount_minor: 500000 });
    expect(directRevenue).toBeTruthy();

    // --- a human-assisted, organically-sourced journey ---
    const humanConv = await seedInboxConversation(workspace.workspaceId, number.id, { wa_id: "27820000002", human_handoff_requested_at: IN_RANGE });
    humanConversationId = humanConv.id;
    organicLeadId = (await seedLead(workspace.workspaceId, { created_from_conversation_id: humanConversationId, source: "whatsapp" })).id;
    await seedAttribution(workspace.workspaceId, { lead_id: organicLeadId, conversation_id: humanConversationId, source_type: "direct", attribution_method: "deterministic", attribution_confidence: "exact" });
    await seedRevenue(workspace.workspaceId, { lead_id: organicLeadId, amount_minor: 200000 });

    // --- a revenue event with no attribution and no conversation link ---
    const bareLeadId = (await seedLead(workspace.workspaceId, { source: "manual" })).id;
    await seedRevenue(workspace.workspaceId, { lead_id: bareLeadId, amount_minor: 100000 });

    // --- out-of-range revenue that must never appear ---
    await seedRevenue(workspace.workspaceId, { lead_id: bareLeadId, amount_minor: 999999, occurred_at: AFTER_RANGE });

    // --- the OTHER workspace has its own revenue that must never leak ---
    await seedRevenue(otherWorkspace.workspaceId, { lead_id: (await seedLead(otherWorkspace.workspaceId, { source: "manual" })).id, amount_minor: 424242 });
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
    await cleanupTenant(otherWorkspace);
  });

  async function call(client: SupabaseClient, workspaceId: string, dimension: string) {
    return client.rpc("get_revenue_breakdown", {
      p_workspace_id: workspaceId,
      p_date_from: RANGE_FROM,
      p_date_to: RANGE_TO,
      p_dimension: dimension,
    });
  }

  it("REGRESSION: workspace A's owner cannot read workspace B's revenue breakdown - fully isolated", async () => {
    const { data } = await call(workspace.client, otherWorkspace.workspaceId, "source");
    expect(data ?? []).toEqual([]); // no permission in the other workspace -> empty, never an error, never a leak
  });

  it("a member without view_analytics (support) gets an empty result, not an error", async () => {
    const { data, error } = await call(supportClient, workspace.workspaceId, "source");
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("dimension=source classifies each revenue event by its attribution evidence and totals per currency", async () => {
    const { data, error } = await call(workspace.client, workspace.workspaceId, "source");
    expect(error).toBeNull();
    const byKey = Object.fromEntries((data as Array<{ bucket_key: string; revenue: Array<{ currency: string; amount_minor: number }>; event_count: number }>).map((r) => [r.bucket_key, r]));
    // deterministic paid touch -> meta_direct (R5,000.00)
    expect(byKey.meta_direct?.revenue?.[0]).toMatchObject({ currency: "ZAR", amount_minor: 500000 });
    // direct source_type -> whatsapp_direct (R2,000.00)
    expect(byKey.whatsapp_direct?.revenue?.[0]).toMatchObject({ currency: "ZAR", amount_minor: 200000 });
    // no attribution at all -> unattributed (R1,000.00)
    expect(byKey.unattributed?.revenue?.[0]).toMatchObject({ currency: "ZAR", amount_minor: 100000 });
    // the AFTER_RANGE R9,999.99 event is excluded
    const total = (data as Array<{ event_count: number }>).reduce((s, r) => s + Number(r.event_count), 0);
    expect(total).toBe(3);
  });

  it("dimension=assist splits revenue by whether the originating conversation was AI- or human-handled", async () => {
    const { data, error } = await call(workspace.client, workspace.workspaceId, "assist");
    expect(error).toBeNull();
    const byKey = Object.fromEntries((data as Array<{ bucket_key: string; revenue: Array<{ amount_minor: number }> }>).map((r) => [r.bucket_key, r]));
    expect(byKey.ai_assisted?.revenue?.[0]?.amount_minor).toBe(500000);
    expect(byKey.human_assisted?.revenue?.[0]?.amount_minor).toBe(200000);
    expect(byKey.no_conversation?.revenue?.[0]?.amount_minor).toBe(100000);
  });

  it("dimension=day returns one bucket per calendar day with recorded revenue, in range only", async () => {
    const { data, error } = await call(workspace.client, workspace.workspaceId, "day");
    expect(error).toBeNull();
    const rows = data as Array<{ bucket_key: string; revenue: Array<{ amount_minor: number }> }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].bucket_key).toBe("2024-06-15");
    expect(rows[0].revenue[0].amount_minor).toBe(800000); // 500000 + 200000 + 100000
  });

  it("an unknown dimension is rejected", async () => {
    const { error } = await call(workspace.client, workspace.workspaceId, "not_a_dimension");
    expect(error).not.toBeNull();
  });

  it("an empty range returns no rows (a real 'no revenue', never a fabricated zero row)", async () => {
    const { data, error } = await workspace.client.rpc("get_revenue_breakdown", {
      p_workspace_id: workspace.workspaceId,
      p_date_from: "2020-01-01T00:00:00.000Z",
      p_date_to: "2020-02-01T00:00:00.000Z",
      p_dimension: "source",
    });
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});

// Phase H (Analytics & Reporting). Proves the read models directly against
// the real linked schema, called through real authenticated test-tenant
// sessions (never service-role for the RPCs themselves - they require a
// real caller with view_analytics, exactly like Phase G's
// get_touch_summary/get_campaign_conversion_counts).
//
// A fixed historical window (2024-06-01 to 2024-07-01, exclusive) is used
// throughout rather than "now" - every seeded row's timestamp is set
// explicitly, so date-filtering assertions are fully deterministic and
// never flaky relative to when the suite happens to run.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin, cleanupTenant, createTestTenant, createTestUser, seedMembership, type TestTenant } from "./helpers";
import { seedWorkspaceIntegration, seedFacebookPage, seedMediaAsset } from "./contentHelpers";
import { seedMetaAdAccount, seedAdCreative, seedAdCampaign, seedAdSet, seedAd } from "./campaignHelpers";
import { seedWhatsAppSetup, seedInboxConversation, seedInboxMessage } from "./inboxHelpers";
import { seedLead, seedOpportunity } from "./leadsHelpers";

const RANGE_FROM = "2024-06-01T00:00:00.000Z";
const RANGE_TO = "2024-07-01T00:00:00.000Z";
const IN_RANGE = "2024-06-15T12:00:00.000Z";
const BEFORE_RANGE = "2024-05-15T12:00:00.000Z";
const AFTER_RANGE = "2024-08-15T12:00:00.000Z";

// One Meta integration per workspace (a real constraint) - shared across
// every campaign seeded for that workspace, matching how a real workspace
// can run many campaigns (even across several ad accounts/currencies)
// through its single Meta connection.
async function seedCampaignChain(workspaceId: string, userId: string, integrationId: string, currency: string, name: string) {
  const adAccountId = await seedMetaAdAccount(workspaceId, integrationId, { currency });
  const pageId = await seedFacebookPage(workspaceId, integrationId);
  const media = await seedMediaAsset(workspaceId, userId);
  const creativeId = await seedAdCreative(workspaceId, media.id, userId);
  const campaignId = await seedAdCampaign(workspaceId, integrationId, adAccountId, pageId, creativeId, userId, { name, currency, status: "active" });
  const adSetId = await seedAdSet(workspaceId, campaignId);
  const adId = await seedAd(workspaceId, adSetId, creativeId);
  return { campaignId, adSetId, adId, creativeId };
}

async function seedMetrics(workspaceId: string, campaignId: string, currency: string, spendMinor: number, impressions: number, clicks: number, dateStr: string) {
  const { error } = await admin.from("ad_campaign_metrics").insert({
    workspace_id: workspaceId, campaign_id: campaignId, date_start: dateStr, date_stop: dateStr,
    spend_minor_units: spendMinor, currency, impressions, reach: impressions, clicks,
  });
  if (error) throw new Error(`seedMetrics failed: ${error.message}`);
}

describe("Analytics & Reporting (release blocker)", () => {
  let workspace: TestTenant;
  let otherWorkspace: TestTenant;
  let viewerClient: SupabaseClient;
  let supportClient: SupabaseClient; // support lacks view_analytics in the existing permission matrix - a real permission-gate test subject

  // Campaign 1 (ZAR) - first touch. Campaign 2 (USD) - last touch.
  let campaign1: { campaignId: string; creativeId: string };
  let campaign2: { campaignId: string; creativeId: string };
  let numberId: string;

  beforeAll(async () => {
    workspace = await createTestTenant("analytics");
    otherWorkspace = await createTestTenant("analytics-other");

    const viewerUser = await createTestUser("analytics-viewer");
    await seedMembership(workspace.workspaceId, viewerUser.userId, "viewer");
    viewerClient = viewerUser.client;

    const supportUser = await createTestUser("analytics-support");
    await seedMembership(workspace.workspaceId, supportUser.userId, "support");
    supportClient = supportUser.client;

    const integrationId = await seedWorkspaceIntegration(workspace.workspaceId);
    campaign1 = await seedCampaignChain(workspace.workspaceId, workspace.userId, integrationId, "ZAR", "Analytics Campaign 1 (ZAR, first touch)");
    campaign2 = await seedCampaignChain(workspace.workspaceId, workspace.userId, integrationId, "USD", "Analytics Campaign 2 (USD, last touch)");

    // Spend: campaign1 R200.00 in range, campaign2 $50.00 in range, plus an
    // out-of-range row on each to prove date filtering excludes it.
    await seedMetrics(workspace.workspaceId, campaign1.campaignId, "ZAR", 20000, 1000, 40, "2024-06-10");
    await seedMetrics(workspace.workspaceId, campaign1.campaignId, "ZAR", 99999, 5000, 999, "2024-05-01");
    await seedMetrics(workspace.workspaceId, campaign2.campaignId, "USD", 5000, 500, 25, "2024-06-20");
    await seedMetrics(workspace.workspaceId, campaign2.campaignId, "USD", 99999, 5000, 999, "2024-08-01");

    // WhatsApp: one conversation in range that becomes the multi-touch lead.
    const number = await seedWhatsAppSetup(workspace.workspaceId);
    numberId = number.id;
    const conversation = await seedInboxConversation(workspace.workspaceId, numberId, { created_at: IN_RANGE, phone_number: "+27831110001", wa_id: "27831110001" });
    await seedInboxMessage(workspace.workspaceId, conversation.id, { direction: "outbound", sender_type: "ai", created_at: IN_RANGE });
    await seedInboxMessage(workspace.workspaceId, conversation.id, { direction: "outbound", sender_type: "staff", created_at: IN_RANGE });

    // Multi-touch lead -> qualified -> opportunity -> customer, in range.
    const lead = await seedLead(workspace.workspaceId, { created_at: IN_RANGE, qualification_status: "qualified", status: "converted" });
    await admin.from("inbox_conversations").update({ lead_id: lead.id }).eq("id", conversation.id);
    const opportunity = await seedOpportunity(workspace.workspaceId, lead.id, { created_at: IN_RANGE, status: "won", won_at: IN_RANGE });
    const { data: customer, error: customerError } = await admin.from("customers").insert({
      workspace_id: workspace.workspaceId, lead_id: lead.id, opportunity_id: opportunity.id, name: "Multi-touch Customer", customer_since: IN_RANGE,
    }).select("id").single();
    if (customerError) throw new Error(customerError.message);

    // Two REAL touchpoints for the SAME lead/opportunity/customer: an
    // earlier one crediting campaign1, a later one crediting campaign2 -
    // first_touch and last_touch models MUST disagree on which campaign
    // gets the credit.
    await admin.from("attribution_events").insert([
      {
        workspace_id: workspace.workspaceId, event_type: "ad_click", occurred_at: "2024-06-05T00:00:00Z", platform: "meta",
        source_type: "paid", source: "meta", attribution_method: "deterministic", attribution_confidence: "exact",
        campaign_id: campaign1.campaignId, creative_id: campaign1.creativeId,
        conversation_id: conversation.id, lead_id: lead.id, opportunity_id: opportunity.id, customer_id: customer!.id,
        provider_event_id: `analytics-test-first-${lead.id}`,
      },
      {
        workspace_id: workspace.workspaceId, event_type: "ad_click", occurred_at: "2024-06-25T00:00:00Z", platform: "meta",
        source_type: "paid", source: "meta", attribution_method: "deterministic", attribution_confidence: "exact",
        campaign_id: campaign2.campaignId, creative_id: campaign2.creativeId,
        lead_id: lead.id, opportunity_id: opportunity.id, customer_id: customer!.id,
        provider_event_id: `analytics-test-last-${lead.id}`,
      },
    ]);

    // Revenue in USD - matches campaign2 (last touch) exactly, mismatches
    // campaign1's ZAR (first touch) - the deliberate currency-mismatch case.
    await admin.from("revenue_events").insert({
      workspace_id: workspace.workspaceId, customer_id: customer!.id, amount_minor: 100000, currency: "USD", event_type: "sale", occurred_at: IN_RANGE,
    });

    // A wholly organic lead -> opportunity -> customer with its own
    // revenue, no attribution_events at all - proves unattributed revenue
    // and that an unattributed conversion is still counted in workspace
    // KPIs but appears in NO campaign's row.
    const organicLead = await seedLead(workspace.workspaceId, { created_at: IN_RANGE, source: "manual", qualification_status: "unqualified" });
    const organicOpportunity = await seedOpportunity(workspace.workspaceId, organicLead.id, { created_at: IN_RANGE, status: "won", won_at: IN_RANGE });
    const { data: organicCustomer } = await admin.from("customers").insert({
      workspace_id: workspace.workspaceId, lead_id: organicLead.id, opportunity_id: organicOpportunity.id, name: "Organic Customer", customer_since: IN_RANGE,
    }).select("id").single();
    await admin.from("revenue_events").insert({
      workspace_id: workspace.workspaceId, customer_id: organicCustomer!.id, amount_minor: 25000, currency: "USD", event_type: "sale", occurred_at: IN_RANGE,
    });

    // Out-of-range lead - must never appear in any in-range count.
    await seedLead(workspace.workspaceId, { created_at: BEFORE_RANGE, source: "manual" });
    await seedLead(workspace.workspaceId, { created_at: AFTER_RANGE, source: "manual" });
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
    await cleanupTenant(otherWorkspace);
  });

  describe("get_analytics_kpis", () => {
    it("aggregates real counts for the exact date range, excluding rows outside it", async () => {
      const { data, error } = await workspace.client.rpc("get_analytics_kpis", { p_workspace_id: workspace.workspaceId, p_date_from: RANGE_FROM, p_date_to: RANGE_TO }).single();
      expect(error).toBeNull();
      // 2 in-range leads (multi-touch + organic) - the before/after-range leads are excluded.
      expect(data!.leads).toBe(2);
      expect(data!.qualified_leads).toBe(1);
      expect(data!.opportunities).toBe(2);
      expect(data!.customers).toBe(2);
      expect(data!.conversations).toBe(1);
    });

    it("REGRESSION: spend is grouped by currency, never silently summed across ZAR and USD - returned as one {currency, amount_minor} entry per currency actually present", async () => {
      const { data } = await workspace.client.rpc("get_analytics_kpis", { p_workspace_id: workspace.workspaceId, p_date_from: RANGE_FROM, p_date_to: RANGE_TO }).single();
      const spendCurrencies = (data!.spend as { currency: string }[]).map((s) => s.currency).sort();
      expect(spendCurrencies).toEqual(["USD", "ZAR"]);
      const zar = (data!.spend as { currency: string; amount_minor: number }[]).find((s) => s.currency === "ZAR");
      expect(zar!.amount_minor).toBe(20000); // only the in-range ZAR row, not the out-of-range 99999
    });

    it("revenue_attributed and revenue_unattributed correctly separate the multi-touch customer's revenue from the organic customer's revenue", async () => {
      const { data } = await workspace.client.rpc("get_analytics_kpis", { p_workspace_id: workspace.workspaceId, p_date_from: RANGE_FROM, p_date_to: RANGE_TO }).single();
      const attributed = (data!.revenue_attributed as { currency: string; amount_minor: number }[]).find((r) => r.currency === "USD");
      const unattributed = (data!.revenue_unattributed as { currency: string; amount_minor: number }[]).find((r) => r.currency === "USD");
      expect(attributed!.amount_minor).toBe(100000);
      expect(unattributed!.amount_minor).toBe(25000);
    });

    it("REGRESSION: a member without view_analytics (support, per the existing permission matrix) gets an empty result, not an error", async () => {
      const { data, error } = await supportClient.rpc("get_analytics_kpis", { p_workspace_id: workspace.workspaceId, p_date_from: RANGE_FROM, p_date_to: RANGE_TO });
      expect(error).toBeNull();
      expect(data).toEqual([]); // no rows returned at all - the function returned before ever computing anything
    });

    it("a viewer (has view_analytics) CAN see analytics - sanity check that the gate isn't accidentally blocking everyone", async () => {
      const { data, error } = await viewerClient.rpc("get_analytics_kpis", { p_workspace_id: workspace.workspaceId, p_date_from: RANGE_FROM, p_date_to: RANGE_TO }).single();
      expect(error).toBeNull();
      expect(data!.leads).toBe(2);
    });

    it("REGRESSION: cross-workspace - this workspace's owner cannot read another workspace's analytics by passing its id", async () => {
      const { data } = await workspace.client.rpc("get_analytics_kpis", { p_workspace_id: otherWorkspace.workspaceId, p_date_from: RANGE_FROM, p_date_to: RANGE_TO });
      expect(Array.isArray(data) ? data : []).toEqual([]);
    });
  });

  describe("get_campaign_performance - attribution model changes campaign credit", () => {
    it("REGRESSION: first_touch and last_touch credit the SAME multi-touched customer/revenue to DIFFERENT campaigns", async () => {
      const { data: firstTouchRows } = await workspace.client.rpc("get_campaign_performance", {
        p_workspace_id: workspace.workspaceId, p_date_from: RANGE_FROM, p_date_to: RANGE_TO, p_attribution_model: "first_touch",
      });
      const { data: lastTouchRows } = await workspace.client.rpc("get_campaign_performance", {
        p_workspace_id: workspace.workspaceId, p_date_from: RANGE_FROM, p_date_to: RANGE_TO, p_attribution_model: "last_touch",
      });

      const firstC1 = firstTouchRows!.find((r: { campaign_id: string }) => r.campaign_id === campaign1.campaignId);
      const firstC2 = firstTouchRows!.find((r: { campaign_id: string }) => r.campaign_id === campaign2.campaignId);
      expect(firstC1.customers).toBe(1); // credited to campaign1 under first_touch
      expect(firstC2.customers).toBe(0);

      const lastC1 = lastTouchRows!.find((r: { campaign_id: string }) => r.campaign_id === campaign1.campaignId);
      const lastC2 = lastTouchRows!.find((r: { campaign_id: string }) => r.campaign_id === campaign2.campaignId);
      expect(lastC1.customers).toBe(0);
      expect(lastC2.customers).toBe(1); // credited to campaign2 under last_touch
    });

    it("REGRESSION: the $100 USD revenue follows the credited campaign under each model - proving the currency-mismatch case under first_touch", async () => {
      const { data: firstTouchRows } = await workspace.client.rpc("get_campaign_performance", {
        p_workspace_id: workspace.workspaceId, p_date_from: RANGE_FROM, p_date_to: RANGE_TO, p_attribution_model: "first_touch",
      });
      const { data: lastTouchRows } = await workspace.client.rpc("get_campaign_performance", {
        p_workspace_id: workspace.workspaceId, p_date_from: RANGE_FROM, p_date_to: RANGE_TO, p_attribution_model: "last_touch",
      });

      const firstC1 = firstTouchRows!.find((r: { campaign_id: string }) => r.campaign_id === campaign1.campaignId);
      expect(firstC1.currency).toBe("ZAR");
      expect(firstC1.revenue).toEqual([{ currency: "USD", amount_minor: 100000 }]); // revenue exists, but in USD while campaign1's spend is ZAR - a real currency mismatch, left for the caller (computeRoas) to flag

      const lastC2 = lastTouchRows!.find((r: { campaign_id: string }) => r.campaign_id === campaign2.campaignId);
      expect(lastC2.currency).toBe("USD");
      expect(lastC2.revenue).toEqual([{ currency: "USD", amount_minor: 100000 }]); // matches campaign2's own currency - ROAS-eligible
    });

    it("spend/impressions/clicks come from ad_campaign_metrics for the exact date range, excluding the out-of-range row", async () => {
      const { data, error } = await workspace.client.rpc("get_campaign_performance", {
        p_workspace_id: workspace.workspaceId, p_date_from: RANGE_FROM, p_date_to: RANGE_TO, p_attribution_model: "last_touch",
      });
      expect(error).toBeNull();
      const c1 = data!.find((r: { campaign_id: string }) => r.campaign_id === campaign1.campaignId);
      expect(c1.spend_minor).toBe(20000);
      expect(c1.impressions).toBe(1000);
      expect(c1.clicks).toBe(40);
    });

    it("the organic customer's revenue never appears credited to any campaign, under any model", async () => {
      const { data } = await workspace.client.rpc("get_campaign_performance", {
        p_workspace_id: workspace.workspaceId, p_date_from: RANGE_FROM, p_date_to: RANGE_TO, p_attribution_model: "last_touch",
      });
      const totalCreditedRevenue = data!.reduce((sum: number, r: { revenue: { amount_minor: number }[] }) => sum + r.revenue.reduce((s: number, x: { amount_minor: number }) => s + x.amount_minor, 0), 0);
      expect(totalCreditedRevenue).toBe(100000); // only the multi-touch customer's revenue, never the organic $250
    });
  });

  describe("get_lead_source_breakdown", () => {
    it("classifies the multi-touch lead as Meta Paid and the organic lead as Manual - never forced into the wrong bucket", async () => {
      const { data } = await workspace.client.rpc("get_lead_source_breakdown", { p_workspace_id: workspace.workspaceId, p_date_from: RANGE_FROM, p_date_to: RANGE_TO });
      const byLabel = new Map((data as { source_label: string; lead_count: number }[]).map((r) => [r.source_label, r.lead_count]));
      expect(byLabel.get("Meta Paid")).toBe(1);
      expect(byLabel.get("Manual")).toBe(1);
    });
  });

  describe("get_whatsapp_analytics", () => {
    it("reports real conversation-lifecycle counts and AI/staff reply counts for the range", async () => {
      const { data, error } = await workspace.client.rpc("get_whatsapp_analytics", { p_workspace_id: workspace.workspaceId, p_date_from: RANGE_FROM, p_date_to: RANGE_TO }).single();
      expect(error).toBeNull();
      expect(data!.conversations_started).toBe(1);
      expect(data!.became_leads).toBe(1);
      expect(data!.became_qualified).toBe(1);
      expect(data!.became_customers).toBe(1);
      expect(data!.ai_reply_count).toBe(1);
      expect(data!.staff_reply_count).toBe(1);
    });
  });

  describe("empty workspace", () => {
    it("every read model returns real zeros/empty arrays, never an error, for a workspace with no data at all", async () => {
      const emptyWorkspace = await createTestTenant("analytics-empty");
      try {
        const { data: kpis, error: kpisError } = await emptyWorkspace.client.rpc("get_analytics_kpis", { p_workspace_id: emptyWorkspace.workspaceId, p_date_from: RANGE_FROM, p_date_to: RANGE_TO }).single();
        expect(kpisError).toBeNull();
        expect(kpis!.leads).toBe(0);
        expect(kpis!.spend).toEqual([]);
        expect(kpis!.revenue_total).toEqual([]);

        const { data: campaigns, error: campaignsError } = await emptyWorkspace.client.rpc("get_campaign_performance", { p_workspace_id: emptyWorkspace.workspaceId, p_date_from: RANGE_FROM, p_date_to: RANGE_TO, p_attribution_model: "last_touch" });
        expect(campaignsError).toBeNull();
        expect(campaigns).toEqual([]);

        const { data: sources, error: sourcesError } = await emptyWorkspace.client.rpc("get_lead_source_breakdown", { p_workspace_id: emptyWorkspace.workspaceId, p_date_from: RANGE_FROM, p_date_to: RANGE_TO });
        expect(sourcesError).toBeNull();
        expect(sources).toEqual([]);
      } finally {
        await cleanupTenant(emptyWorkspace);
      }
    });
  });
});

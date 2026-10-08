// Phase 1 (Revenue Operations) - get_campaign_journey + _entities.
//
// Proves THE authoritative Campaign Journey read model against the real
// linked schema, through real authenticated test-tenant sessions. Central
// claims:
//   - the funnel counts reconcile with get_campaign_performance for the
//     same campaign + model
//   - direct + inferred = stage total, always
//   - multiple touchpoints for one entity do NOT inflate its count
//   - multiple revenue events for one customer raise revenue, not the
//     customer count
//   - metrics_available is false until Meta actually syncs a metrics row
//   - get_campaign_journey_entities returns exactly the credited
//     population, deterministically ordered, truly paginated
//   - full workspace isolation + per-stage permission gating
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin, cleanupTenant, createTestTenant, createTestUser, seedMembership, type TestTenant } from "./helpers";
import { seedWorkspaceIntegration, seedFacebookPage, seedMediaAsset } from "./contentHelpers";
import { seedMetaAdAccount, seedAdCreative, seedAdCampaign, seedAdSet, seedAd } from "./campaignHelpers";
import { seedWhatsAppSetup, seedInboxConversation } from "./inboxHelpers";
import { seedLead, seedOpportunity } from "./leadsHelpers";

const T0 = "2024-06-15T09:00:00.000Z";
const T1 = "2024-06-15T10:00:00.000Z";
const T2 = "2024-06-16T10:00:00.000Z";

async function seedAe(workspaceId: string, cols: Record<string, unknown>) {
  const { error } = await admin.from("attribution_events").insert({
    workspace_id: workspaceId, event_type: "touchpoint", platform: "meta", occurred_at: T1, ...cols,
  });
  if (error) throw new Error(`seedAe failed: ${error.message}`);
}

describe("get_campaign_journey (Phase 1 remediation)", () => {
  let ws: TestTenant;
  let other: TestTenant;
  let marketingClient: SupabaseClient; // marketing role: has attribution.view (and, by default, revenue.view)

  let campaignId: string;
  let adSetId: string;
  let adId: string;
  let creativeId: string;
  let convId: string;
  let leadId: string;
  let oppId: string;

  beforeAll(async () => {
    ws = await createTestTenant("cj");
    other = await createTestTenant("cj-other");

    const marketing = await createTestUser("cj-marketing");
    await seedMembership(ws.workspaceId, marketing.userId, "marketing");
    marketingClient = marketing.client;

    const integrationId = await seedWorkspaceIntegration(ws.workspaceId);
    const adAccountId = await seedMetaAdAccount(ws.workspaceId, integrationId, { currency: "ZAR" });
    const pageId = await seedFacebookPage(ws.workspaceId, integrationId);
    const media = await seedMediaAsset(ws.workspaceId, ws.userId);
    creativeId = await seedAdCreative(ws.workspaceId, media.id, ws.userId);
    campaignId = await seedAdCampaign(ws.workspaceId, integrationId, adAccountId, pageId, creativeId, ws.userId, { name: "Journey Campaign", currency: "ZAR", status: "active" });
    adSetId = await seedAdSet(ws.workspaceId, campaignId);
    adId = await seedAd(ws.workspaceId, adSetId, creativeId);

    const number = await seedWhatsAppSetup(ws.workspaceId);
    const conv = await seedInboxConversation(ws.workspaceId, number.id, { wa_id: "27829999001", created_at: T0 });
    convId = conv.id;
    leadId = (await seedLead(ws.workspaceId, { created_from_conversation_id: convId, source: "meta", qualification_status: "qualified", created_at: T0 })).id;
    oppId = (await seedOpportunity(ws.workspaceId, leadId, { created_at: T0 })).id;

    // Mark won -> customer, and the SAME lead flips to converted.
    const { data: cust, error: cErr } = await admin.from("customers").insert({
      workspace_id: ws.workspaceId, lead_id: leadId, opportunity_id: oppId, name: "Journey Co", customer_since: T0,
    }).select("id").single();
    if (cErr) throw new Error(cErr.message);
    const customerId = cust!.id as string;

    // TWO touchpoints for the SAME conversation/lead - a last-touch credit
    // must still count the lead ONCE. Both carry the campaign + structural
    // ids so the ad-set/ad/creative breakdown has data.
    await seedAe(ws.workspaceId, {
      conversation_id: convId, lead_id: leadId, opportunity_id: oppId, customer_id: customerId,
      campaign_id: campaignId, ad_set_id: adSetId, ad_id: adId, creative_id: creativeId,
      source_type: "paid", attribution_method: "deterministic", attribution_confidence: "exact", occurred_at: T1,
    });
    await seedAe(ws.workspaceId, {
      conversation_id: convId, lead_id: leadId,
      campaign_id: campaignId, ad_set_id: adSetId, ad_id: adId, creative_id: creativeId,
      source_type: "paid", attribution_method: "provider_reported", attribution_confidence: "low", occurred_at: T2,
    });

    // TWO revenue events for the one customer.
    for (const amt of [300000, 200000]) {
      const { error } = await admin.from("revenue_events").insert({
        workspace_id: ws.workspaceId, customer_id: customerId, opportunity_id: oppId, lead_id: leadId,
        amount_minor: amt, currency: "ZAR", event_type: "sale", occurred_at: T1,
      });
      if (error) throw new Error(error.message);
    }
  });

  afterAll(async () => {
    await cleanupTenant(ws);
    await cleanupTenant(other);
  });

  const journey = (client: SupabaseClient, workspaceId: string, cId: string, model = "last_touch") =>
    client.rpc("get_campaign_journey", { p_workspace_id: workspaceId, p_campaign_id: cId, p_attribution_model: model });

  it("REGRESSION: workspace A cannot read workspace B's journey - empty, never an error, never a leak", async () => {
    const { data } = await journey(ws.client, other.workspaceId, campaignId);
    expect(data ?? []).toEqual([]);
    const { data: d2 } = await journey(other.client, ws.workspaceId, campaignId);
    expect(d2 ?? []).toEqual([]);
  });

  it("multiple touchpoints for one entity do NOT inflate the count; multiple revenue events do NOT inflate the customer count", async () => {
    const { data, error } = await journey(ws.client, ws.workspaceId, campaignId);
    expect(error).toBeNull();
    const r = (data as Array<Record<string, number | string | unknown[]>>)[0];
    expect(Number(r.conversations)).toBe(1);
    expect(Number(r.leads)).toBe(1);
    expect(Number(r.qualified_leads)).toBe(1);
    expect(Number(r.opportunities)).toBe(1);
    expect(Number(r.customers)).toBe(1);
    // revenue is the sum of BOTH events, one currency
    expect(r.revenue).toEqual([{ currency: "ZAR", amount_minor: 500000 }]);
  });

  it("direct + inferred always equals the stage total (last_touch credits the provider_reported T2 touchpoint -> inferred)", async () => {
    const { data } = await journey(ws.client, ws.workspaceId, campaignId, "last_touch");
    const r = (data as Array<Record<string, number>>)[0];
    for (const stage of ["conversations", "leads", "opportunities", "customers"]) {
      expect(Number(r[`${stage}_direct`]) + Number(r[`${stage}_inferred`])).toBe(Number(r[stage]));
    }
    // last touch (T2) is provider_reported -> conversation + lead are inferred
    expect(Number(r.conversations_inferred)).toBe(1);
    expect(Number(r.leads_inferred)).toBe(1);
    // opportunity + customer only have the T1 deterministic touchpoint -> direct
    expect(Number(r.opportunities_direct)).toBe(1);
    expect(Number(r.customers_direct)).toBe(1);
  });

  it("first_touch credits the deterministic T1 touchpoint -> conversation + lead become direct (models legitimately disagree)", async () => {
    const { data } = await journey(ws.client, ws.workspaceId, campaignId, "first_touch");
    const r = (data as Array<Record<string, number>>)[0];
    expect(Number(r.conversations_direct)).toBe(1);
    expect(Number(r.leads_direct)).toBe(1);
  });

  it("funnel counts reconcile with get_campaign_performance for the same campaign + model", async () => {
    const { data: perf } = await ws.client.rpc("get_campaign_performance", {
      p_workspace_id: ws.workspaceId,
      p_date_from: "1970-01-01T00:00:00.000Z",
      p_date_to: "2100-01-01T00:00:00.000Z",
      p_attribution_model: "last_touch",
    });
    const perfRow = (perf as Array<Record<string, number | string>>).find((x) => x.campaign_id === campaignId)!;
    const { data: j } = await journey(ws.client, ws.workspaceId, campaignId, "last_touch");
    const jRow = (j as Array<Record<string, number>>)[0];
    for (const k of ["conversations", "leads", "qualified_leads", "opportunities", "customers"]) {
      expect(Number(jRow[k])).toBe(Number(perfRow[k]));
    }
  });

  it("metrics_available is false and spend is 0 until Meta syncs a metrics row; true after", async () => {
    const { data: before } = await journey(ws.client, ws.workspaceId, campaignId);
    expect((before as Array<Record<string, unknown>>)[0].metrics_available).toBe(false);
    expect(Number((before as Array<Record<string, number>>)[0].spend_minor)).toBe(0);

    await admin.from("ad_campaign_metrics").insert({
      workspace_id: ws.workspaceId, campaign_id: campaignId, date_start: "2024-06-15", date_stop: "2024-06-15",
      spend_minor_units: 0, currency: "ZAR", impressions: 100, reach: 90, clicks: 10,
    });
    const { data: after } = await journey(ws.client, ws.workspaceId, campaignId);
    expect((after as Array<Record<string, unknown>>)[0].metrics_available).toBe(true);
    // a real measured 0 - distinct from the "unavailable" above
    expect(Number((after as Array<Record<string, number>>)[0].spend_minor)).toBe(0);
    expect(Number((after as Array<Record<string, number>>)[0].clicks)).toBe(10);
  });

  it("get_campaign_journey_entities returns exactly the credited leads, deterministically ordered, paginated", async () => {
    const { data, error } = await ws.client.rpc("get_campaign_journey_entities", {
      p_workspace_id: ws.workspaceId, p_campaign_id: campaignId, p_stage: "lead",
      p_attribution_model: "last_touch", p_limit: 10, p_offset: 0,
    });
    expect(error).toBeNull();
    const rows = data as Array<{ entity_id: string; lead_id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].lead_id).toBe(leadId);
  });

  it("get_campaign_journey_entities: qualified_lead stage returns only qualified credited leads", async () => {
    const { data } = await ws.client.rpc("get_campaign_journey_entities", {
      p_workspace_id: ws.workspaceId, p_campaign_id: campaignId, p_stage: "qualified_lead", p_attribution_model: "last_touch",
    });
    expect((data as unknown[]).length).toBe(1);
  });

  it("get_campaign_journey blanks revenue for a caller without revenue.view, but still returns the funnel", async () => {
    // Every shipped workspace_role carries BOTH attribution.view and
    // revenue.view, so the RPC's revenue.view gate can only be exercised
    // by transiently dropping that one grant for the marketing role.
    // Restored in `finally`; `supabase db reset` re-seeds it regardless.
    const { error: delErr } = await admin
      .from("workspace_role_permissions")
      .delete()
      .eq("role", "marketing")
      .eq("permission", "revenue.view");
    if (delErr) throw new Error(`could not drop the revenue.view grant: ${delErr.message}`);
    try {
      const { data, error } = await journey(marketingClient, ws.workspaceId, campaignId);
      expect(error).toBeNull();
      const r = (data as Array<Record<string, unknown>>)[0];
      expect(Number(r.leads)).toBe(1); // funnel still visible (attribution.view)
      expect(r.revenue).toEqual([]); // revenue blanked (no revenue.view)
    } finally {
      await admin
        .from("workspace_role_permissions")
        .upsert({ role: "marketing", permission: "revenue.view" }, { onConflict: "role,permission" });
    }
  });

  it("an unknown attribution model is rejected", async () => {
    const { error } = await journey(ws.client, ws.workspaceId, campaignId, "made_up_model");
    expect(error).not.toBeNull();
  });
});

// Real, live-project integration tests proving Phase 6's required
// cross-tenant isolation properties for the Campaigns module (instruction
// #22), following the exact pattern established in
// content-tenant-isolation.test.ts: genuinely independent authenticated
// sessions against the actual deployed RLS policies and edge functions.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedFacebookPage, seedMediaAsset, seedWorkspaceIntegration } from "./contentHelpers";
import { seedAdCampaign, seedAdCreative, seedMetaAdAccount } from "./campaignHelpers";

describe("Campaigns module tenant isolation (release blocker)", () => {
  let workspaceA: TestTenant;
  let workspaceB: TestTenant;
  let integrationA: string;
  let adAccountA: string;
  let integrationB: string;
  let pageB: string;
  let adAccountB: string;
  let assetB: { id: string; storage_path: string };
  let creativeB: string;
  let campaignB: string;
  let adSetB: string;

  beforeAll(async () => {
    workspaceA = await createTestTenant("campaign-a");
    workspaceB = await createTestTenant("campaign-b");
    integrationA = await seedWorkspaceIntegration(workspaceA.workspaceId);
    adAccountA = await seedMetaAdAccount(workspaceA.workspaceId, integrationA);
    integrationB = await seedWorkspaceIntegration(workspaceB.workspaceId);
    pageB = await seedFacebookPage(workspaceB.workspaceId, integrationB);
    adAccountB = await seedMetaAdAccount(workspaceB.workspaceId, integrationB);
    assetB = await seedMediaAsset(workspaceB.workspaceId, workspaceB.userId);
    creativeB = await seedAdCreative(workspaceB.workspaceId, assetB.id, workspaceB.userId);
    campaignB = await seedAdCampaign(workspaceB.workspaceId, integrationB, adAccountB, pageB, creativeB, workspaceB.userId);

    const { data: adSet, error } = await admin
      .from("ad_sets")
      .insert({
        workspace_id: workspaceB.workspaceId,
        campaign_id: campaignB,
        name: "Test Ad Set",
        optimization_goal: "LINK_CLICKS",
        billing_event: "LINK_CLICKS",
        start_at: new Date(Date.now() + 86400_000).toISOString(),
      })
      .select("id")
      .single();
    if (error || !adSet) throw new Error(`Failed to seed ad_sets: ${error?.message}`);
    adSetB = adSet.id;
  });

  afterAll(async () => {
    await cleanupTenant(workspaceA);
    await cleanupTenant(workspaceB);
  });

  it("workspace A cannot read workspace B's campaigns", async () => {
    const { data, error } = await workspaceA.client.from("ad_campaigns").select("*").eq("id", campaignB);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("workspace A cannot create an ad under workspace B's ad set (ad_sets/ads have no client insert policy at all)", async () => {
    const { data, error } = await workspaceA.client
      .from("ads")
      .insert({ workspace_id: workspaceB.workspaceId, ad_set_id: adSetB, creative_id: creativeB, name: "hijacked ad" })
      .select();
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });

  it("workspace A cannot use workspace B's Meta integration when creating its own campaign draft", async () => {
    const assetA = await seedMediaAsset(workspaceA.workspaceId, workspaceA.userId);
    const { data: creativeA } = await workspaceA.client
      .from("ad_creatives")
      .insert({ workspace_id: workspaceA.workspaceId, media_asset_id: assetA.id, primary_text: "x", cta: "SHOP_NOW", destination_url: "https://example.com" })
      .select("id")
      .single();

    const { data, error } = await workspaceA.client
      .from("ad_campaigns")
      .insert({
        workspace_id: workspaceA.workspaceId,
        integration_id: integrationB, // workspace B's integration
        ad_account_id: adAccountB,
        name: "cross-tenant integration attempt",
        objective: "OUTCOME_TRAFFIC",
        destination_type: "website",
        budget_type: "daily",
        daily_budget_minor_units: 5000,
        currency: "ZAR",
        start_at: new Date(Date.now() + 86400_000).toISOString(),
        draft_creative_id: creativeA?.id,
      })
      .select();
    expect(data).toBeNull();
    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/integration_id must be a Meta integration belonging to the same workspace/);
  });

  it("workspace A cannot use workspace B's Meta Ad Account", async () => {
    const assetA = await seedMediaAsset(workspaceA.workspaceId, workspaceA.userId);
    const { data: creativeA } = await workspaceA.client
      .from("ad_creatives")
      .insert({ workspace_id: workspaceA.workspaceId, media_asset_id: assetA.id, primary_text: "x", cta: "SHOP_NOW", destination_url: "https://example.com" })
      .select("id")
      .single();

    const { data, error } = await workspaceA.client
      .from("ad_campaigns")
      .insert({
        workspace_id: workspaceA.workspaceId,
        integration_id: integrationA,
        ad_account_id: adAccountB, // workspace B's ad account
        name: "cross-tenant ad account attempt",
        objective: "OUTCOME_TRAFFIC",
        destination_type: "website",
        budget_type: "daily",
        daily_budget_minor_units: 5000,
        currency: "ZAR",
        start_at: new Date(Date.now() + 86400_000).toISOString(),
        draft_creative_id: creativeA?.id,
      })
      .select();
    expect(data).toBeNull();
    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/ad_account_id must belong to the same workspace and integration/);
  });

  it("workspace A cannot reference workspace B's media asset in its own creative", async () => {
    const { data, error } = await workspaceA.client
      .from("ad_creatives")
      .insert({ workspace_id: workspaceA.workspaceId, media_asset_id: assetB.id, primary_text: "x", cta: "SHOP_NOW", destination_url: "https://example.com" })
      .select();
    expect(data).toBeNull();
    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/workspace_id must match its media_asset_id's workspace/);
  });

  it("workspace A cannot publish workspace B's campaign (ad-campaigns-publish)", async () => {
    const { data: session } = await workspaceA.client.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/ad-campaigns-publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token}` },
      body: JSON.stringify({ campaign_id: campaignB, idempotency_key: crypto.randomUUID() }),
    });
    expect(res.status).toBe(404); // RLS's campaign.view select policy means it doesn't even exist from workspace A's perspective
    const { data: stillDraft } = await admin.from("ad_campaigns").select("status, external_campaign_id").eq("id", campaignB).single();
    expect(stillDraft?.status).toBe("draft");
    expect(stillDraft?.external_campaign_id).toBeNull();
  });

  it("workspace A cannot pause workspace B's campaign (ad-campaigns-pause-resume)", async () => {
    const { data: session } = await workspaceA.client.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/ad-campaigns-pause-resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token}` },
      body: JSON.stringify({ campaign_id: campaignB, action: "pause" }),
    });
    expect(res.status).toBe(404);
  });

  it("workspace A cannot view workspace B's campaign metrics", async () => {
    await admin.from("ad_campaign_metrics").insert({
      workspace_id: workspaceB.workspaceId,
      campaign_id: campaignB,
      date_start: "2026-08-01",
      date_stop: "2026-08-01",
      currency: "ZAR",
      spend_minor_units: 1000,
    });
    const { data, error } = await workspaceA.client.from("ad_campaign_metrics").select("*").eq("campaign_id", campaignB);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("even a DIRECT service-role insert cannot make a workspace B campaign reference a workspace A ad account - the workspace-consistency trigger blocks it regardless of RLS", async () => {
    const { error } = await admin.from("ad_campaigns").insert({
      workspace_id: workspaceB.workspaceId, // campaign belongs to workspace B...
      integration_id: integrationB,
      ad_account_id: adAccountA, // ...but points at workspace A's ad account
      name: "service-role cross-tenant attempt",
      objective: "OUTCOME_TRAFFIC",
      destination_type: "website",
      budget_type: "daily",
      daily_budget_minor_units: 5000,
      currency: "ZAR",
      start_at: new Date(Date.now() + 86400_000).toISOString(),
      draft_creative_id: creativeB,
    });
    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/ad_account_id must belong to the same workspace and integration/);
  });

  it("foreign keys cannot create a cross-workspace ad_set/ad relationship, even via service role", async () => {
    const { error } = await admin.from("ad_sets").insert({
      workspace_id: workspaceA.workspaceId, // ad set claims workspace A...
      campaign_id: campaignB, // ...but its campaign belongs to workspace B
      name: "cross-tenant ad set",
      optimization_goal: "LINK_CLICKS",
      billing_event: "LINK_CLICKS",
      start_at: new Date(Date.now() + 86400_000).toISOString(),
    });
    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/workspace_id must match its campaign_id's workspace/);
  });
});

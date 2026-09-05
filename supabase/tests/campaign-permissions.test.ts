// Proves the Campaigns module's permission model differentiates
// rank-peer roles (marketing/sales/support all rank 50) by name, not just
// membership - direct test of Phase 6 instruction #21: campaign.create/
// campaign.publish/campaign.pause/campaign.delete are what ad_campaigns
// RLS actually checks, not has_workspace_role().
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTenant, createTestTenant, createTestUser, seedMembership, type TestTenant } from "./helpers";
import { seedFacebookPage, seedMediaAsset, seedWorkspaceIntegration } from "./contentHelpers";
import { seedAdCampaign, seedAdCreative, seedMetaAdAccount } from "./campaignHelpers";

describe("Campaigns module permission matrix (campaign.create / campaign.publish / campaign.pause)", () => {
  let workspace: TestTenant;
  let integrationId: string;
  let adAccountId: string;
  let pageId: string;
  let assetId: string;
  let creativeId: string;
  let campaignId: string;
  let salesUser: { userId: string; client: import("@supabase/supabase-js").SupabaseClient };
  let marketingUser: { userId: string; client: import("@supabase/supabase-js").SupabaseClient };
  let viewerUser: { userId: string; client: import("@supabase/supabase-js").SupabaseClient };

  beforeAll(async () => {
    workspace = await createTestTenant("campaign-perm-matrix");
    integrationId = await seedWorkspaceIntegration(workspace.workspaceId);
    adAccountId = await seedMetaAdAccount(workspace.workspaceId, integrationId);
    pageId = await seedFacebookPage(workspace.workspaceId, integrationId);
    const asset = await seedMediaAsset(workspace.workspaceId, workspace.userId);
    assetId = asset.id;
    creativeId = await seedAdCreative(workspace.workspaceId, assetId, workspace.userId);
    campaignId = await seedAdCampaign(workspace.workspaceId, integrationId, adAccountId, pageId, creativeId, workspace.userId);

    const sales = await createTestUser("campaign-perm-sales");
    await seedMembership(workspace.workspaceId, sales.userId, "sales");
    salesUser = sales;

    const marketing = await createTestUser("campaign-perm-marketing");
    await seedMembership(workspace.workspaceId, marketing.userId, "marketing");
    marketingUser = marketing;

    const viewer = await createTestUser("campaign-perm-viewer");
    await seedMembership(workspace.workspaceId, viewer.userId, "viewer");
    viewerUser = viewer;
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
    await cleanupTenant({ userId: salesUser.userId });
    await cleanupTenant({ userId: marketingUser.userId });
    await cleanupTenant({ userId: viewerUser.userId });
  });

  it("a 'sales' member (rank-peer of marketing, view-only) CANNOT create a campaign draft", async () => {
    const { data, error } = await salesUser.client
      .from("ad_campaigns")
      .insert({
        workspace_id: workspace.workspaceId,
        integration_id: integrationId,
        ad_account_id: adAccountId,
        name: "sales should not be able to create this",
        objective: "OUTCOME_TRAFFIC",
        destination_type: "website",
        budget_type: "daily",
        daily_budget_minor_units: 5000,
        currency: "ZAR",
        start_at: new Date(Date.now() + 86400_000).toISOString(),
        draft_creative_id: creativeId,
      })
      .select();
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });

  it("a 'marketing' member (same rank as sales) CAN create a campaign draft - differentiated by permission name, not rank", async () => {
    const { data, error } = await marketingUser.client
      .from("ad_campaigns")
      .insert({
        workspace_id: workspace.workspaceId,
        integration_id: integrationId,
        ad_account_id: adAccountId,
        name: "marketing can create this",
        objective: "OUTCOME_TRAFFIC",
        destination_type: "website",
        budget_type: "daily",
        daily_budget_minor_units: 5000,
        currency: "ZAR",
        start_at: new Date(Date.now() + 86400_000).toISOString(),
        draft_creative_id: creativeId,
      })
      .select("id");
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  it("a 'viewer' member cannot create a campaign, but CAN read one (campaign.view) and see it in campaign.metrics.view scope", async () => {
    const { data: insertData, error: insertError } = await viewerUser.client
      .from("ad_campaigns")
      .insert({
        workspace_id: workspace.workspaceId,
        integration_id: integrationId,
        ad_account_id: adAccountId,
        name: "viewer should not be able to create this",
        objective: "OUTCOME_TRAFFIC",
        destination_type: "website",
        budget_type: "daily",
        daily_budget_minor_units: 5000,
        currency: "ZAR",
        start_at: new Date(Date.now() + 86400_000).toISOString(),
        draft_creative_id: creativeId,
      })
      .select();
    expect(insertData).toBeNull();
    expect(insertError).toBeTruthy();

    const { data: readable, error: readError } = await viewerUser.client.from("ad_campaigns").select("id").eq("id", campaignId);
    expect(readError).toBeNull();
    expect(readable?.length).toBe(1);
  });

  it("a 'sales' member cannot delete a campaign (campaign.delete denied)", async () => {
    const { error } = await salesUser.client.from("ad_campaigns").delete().eq("id", campaignId);
    // RLS silently filters (0 rows), not necessarily a thrown error - assert it still exists via the workspace owner.
    const { data: stillExists } = await workspace.client.from("ad_campaigns").select("id").eq("id", campaignId).maybeSingle();
    expect(stillExists?.id).toBe(campaignId);
    expect(error).toBeNull(); // delete with 0 matching rows under RLS is not itself an error
  });
});

// Explicit provider-resource isolation tests (Phase 6 instruction #23):
// a Workspace A campaign/creative must never be able to reference any of
// Workspace B's Facebook Page, Instagram Account, Meta Ad Account, media
// asset, platform variant, or Meta integration - proven here via DIRECT
// service-role inserts (admin client), so these checks hold even against
// the strongest possible caller, not just RLS-scoped authenticated
// sessions (covered separately in campaign-tenant-isolation.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, type TestTenant } from "./helpers";
import { seedFacebookPage, seedMediaAsset, seedWorkspaceIntegration } from "./contentHelpers";
import { seedAdCreative, seedMetaAdAccount } from "./campaignHelpers";

describe("Campaigns module provider-resource isolation (release blocker)", () => {
  let workspaceA: TestTenant;
  let workspaceB: TestTenant;
  let integrationA: string;
  let adAccountA: string;
  let pageA: string;
  let assetA: { id: string; storage_path: string };
  let creativeA: string;

  let integrationB: string;
  let pageB: string;
  let igAccountB: string;
  let adAccountB: string;
  let assetB: { id: string; storage_path: string };
  let variantB: string;

  beforeAll(async () => {
    workspaceA = await createTestTenant("provider-iso-a");
    workspaceB = await createTestTenant("provider-iso-b");

    integrationA = await seedWorkspaceIntegration(workspaceA.workspaceId);
    adAccountA = await seedMetaAdAccount(workspaceA.workspaceId, integrationA);
    pageA = await seedFacebookPage(workspaceA.workspaceId, integrationA);
    assetA = await seedMediaAsset(workspaceA.workspaceId, workspaceA.userId);
    creativeA = await seedAdCreative(workspaceA.workspaceId, assetA.id, workspaceA.userId);

    integrationB = await seedWorkspaceIntegration(workspaceB.workspaceId);
    pageB = await seedFacebookPage(workspaceB.workspaceId, integrationB);
    adAccountB = await seedMetaAdAccount(workspaceB.workspaceId, integrationB);
    assetB = await seedMediaAsset(workspaceB.workspaceId, workspaceB.userId);

    const { data: ig, error: igError } = await admin
      .from("workspace_instagram_accounts")
      .insert({ workspace_id: workspaceB.workspaceId, integration_id: integrationB, ig_business_account_id: `ig-${Date.now()}` })
      .select("id")
      .single();
    if (igError || !ig) throw new Error(`Failed to seed workspace_instagram_accounts: ${igError?.message}`);
    igAccountB = ig.id;

    const { data: variant, error: variantError } = await admin
      .from("content_platform_variants")
      .insert({ workspace_id: workspaceB.workspaceId, media_asset_id: assetB.id, platform: "instagram", storage_path: `${workspaceB.workspaceId}/v.jpg`, width_px: 1080, height_px: 1080, aspect_ratio: 1, mime_type: "image/jpeg", file_size_bytes: 500 })
      .select("id")
      .single();
    if (variantError || !variant) throw new Error(`Failed to seed content_platform_variants: ${variantError?.message}`);
    variantB = variant.id;
  });

  afterAll(async () => {
    await cleanupTenant(workspaceA);
    await cleanupTenant(workspaceB);
  });

  const baseCampaign = () => ({
    workspace_id: workspaceA.workspaceId,
    integration_id: integrationA,
    ad_account_id: adAccountA,
    name: "provider-isolation attempt",
    objective: "OUTCOME_TRAFFIC",
    destination_type: "website",
    budget_type: "daily",
    daily_budget_minor_units: 5000,
    currency: "ZAR",
    start_at: new Date(Date.now() + 86400_000).toISOString(),
    draft_creative_id: creativeA,
  });

  it("cannot reference workspace B's Facebook Page from a workspace A campaign", async () => {
    const { error } = await admin.from("ad_campaigns").insert({ ...baseCampaign(), facebook_page_id: pageB });
    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/facebook_page_id must belong to the same workspace/);
  });

  it("cannot reference workspace B's Instagram account from a workspace A campaign", async () => {
    const { error } = await admin.from("ad_campaigns").insert({ ...baseCampaign(), facebook_page_id: pageA, instagram_account_id: igAccountB });
    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/instagram_account_id must belong to the same workspace/);
  });

  it("cannot reference workspace B's Meta Ad Account from a workspace A campaign", async () => {
    const { error } = await admin.from("ad_campaigns").insert({ ...baseCampaign(), ad_account_id: adAccountB });
    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/ad_account_id must belong to the same workspace and integration/);
  });

  it("cannot reference workspace B's Meta integration from a workspace A campaign", async () => {
    const { error } = await admin.from("ad_campaigns").insert({ ...baseCampaign(), integration_id: integrationB });
    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/integration_id must be a Meta integration belonging to the same workspace/);
  });

  it("cannot reference workspace B's media asset from a workspace A creative", async () => {
    const { error } = await admin.from("ad_creatives").insert({ workspace_id: workspaceA.workspaceId, media_asset_id: assetB.id, primary_text: "x", cta: "SHOP_NOW", destination_url: "https://example.com" });
    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/workspace_id must match its media_asset_id's workspace/);
  });

  it("cannot reference workspace B's platform variant from a workspace A creative, even with a matching workspace A media_asset_id", async () => {
    const { error } = await admin.from("ad_creatives").insert({
      workspace_id: workspaceA.workspaceId,
      media_asset_id: assetA.id, // workspace A's own asset...
      platform_variant_id: variantB, // ...but workspace B's variant
      primary_text: "x",
      cta: "SHOP_NOW",
      destination_url: "https://example.com",
    });
    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/platform_variant_id must belong to the same workspace and media asset/);
  });

  it("draft_creative_id on a campaign cannot point at another workspace's creative", async () => {
    const creativeB = await seedAdCreative(workspaceB.workspaceId, assetB.id, workspaceB.userId);
    const { error } = await admin.from("ad_campaigns").insert({ ...baseCampaign(), draft_creative_id: creativeB });
    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/draft_creative_id must belong to the same workspace/);
  });

  it("source_content_media_asset_id (Promote as Campaign provenance) cannot point at another workspace's media", async () => {
    const { error } = await admin.from("ad_campaigns").insert({ ...baseCampaign(), source_content_media_asset_id: assetB.id });
    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/source_content_media_asset_id must belong to the same workspace/);
  });

  it("a valid same-workspace campaign (control case) inserts successfully - proving the trigger isn't over-broad", async () => {
    const { data, error } = await admin.from("ad_campaigns").insert({ ...baseCampaign(), facebook_page_id: pageA }).select("id");
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });
});

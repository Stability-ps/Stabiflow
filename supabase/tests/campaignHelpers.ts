import { admin } from "./helpers";

export async function seedMetaAdAccount(workspaceId: string, integrationId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("workspace_meta_ad_accounts")
    .insert({ workspace_id: workspaceId, integration_id: integrationId, ad_account_id: `act_${Date.now()}${Math.floor(Math.random() * 10000)}`, name: "Test Ad Account", currency: "ZAR", ...overrides })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to seed workspace_meta_ad_accounts: ${error?.message}`);
  return data.id as string;
}

export async function seedAdCreative(workspaceId: string, mediaAssetId: string, createdBy: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("ad_creatives")
    .insert({
      workspace_id: workspaceId,
      media_asset_id: mediaAssetId,
      primary_text: "Test primary text for the ad",
      cta: "SHOP_NOW",
      destination_url: "https://example.com",
      status: "draft",
      created_by: createdBy,
      ...overrides,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to seed ad_creatives: ${error?.message}`);
  return data.id as string;
}

export async function seedAdCampaign(
  workspaceId: string,
  integrationId: string,
  adAccountId: string,
  facebookPageId: string,
  draftCreativeId: string,
  createdBy: string,
  overrides: Record<string, unknown> = {},
) {
  const { data, error } = await admin
    .from("ad_campaigns")
    .insert({
      workspace_id: workspaceId,
      integration_id: integrationId,
      ad_account_id: adAccountId,
      facebook_page_id: facebookPageId,
      name: "Test Campaign",
      objective: "OUTCOME_TRAFFIC",
      destination_type: "website",
      status: "draft",
      budget_type: "daily",
      daily_budget_minor_units: 5000,
      currency: "ZAR",
      start_at: new Date(Date.now() + 86400_000).toISOString(),
      audience: { age_min: 18, age_max: 65, genders: "all", geo_countries: ["ZA"] },
      draft_creative_id: draftCreativeId,
      created_by: createdBy,
      ...overrides,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to seed ad_campaigns: ${error?.message}`);
  return data.id as string;
}

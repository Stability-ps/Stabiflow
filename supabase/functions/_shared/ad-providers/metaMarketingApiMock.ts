// Mock Meta Marketing API provider (Phase F instruction #43). Same
// function signatures as metaMarketingApi.ts (see adPublishExecution.ts's
// MetaAdsProvider type) so the publish saga's orchestration logic - step
// order, provider_state persistence, partial-failure handling, retry
// resume - can be exercised end to end and genuinely verified, without a
// real Meta API call and without real advertising spend.
//
// Clearly separate from the real provider (never imported by it, never
// silently substituted for it): the calling edge function is the ONLY
// place that decides which one to use, based on this workspace's
// integration being in mock mode (the same INTEGRATIONS_META_MOCK_MODE
// flag Phase C's OAuth connect already uses) - see ad-campaigns-publish/
// index.ts. There is no hidden fallback path from real to mock or back.
import type { CreateAdCreativeInput, CreateAdInput, CreateAdSetInput, CreateCampaignInput, CreatedObject, MetaCredential } from "./types.ts";

function mockId(prefix: string): string {
  return `mock_${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export async function createCampaign(_cred: MetaCredential, _input: CreateCampaignInput): Promise<CreatedObject> {
  return { id: mockId("campaign") };
}

export async function createAdSet(_cred: MetaCredential, _input: CreateAdSetInput): Promise<CreatedObject> {
  return { id: mockId("adset") };
}

export async function createAdCreative(_cred: MetaCredential, _input: CreateAdCreativeInput): Promise<CreatedObject> {
  return { id: mockId("creative") };
}

export async function createAd(_cred: MetaCredential, _input: CreateAdInput): Promise<CreatedObject> {
  return { id: mockId("ad") };
}

export async function updateObjectStatus(_cred: MetaCredential, _externalId: string, _status: "ACTIVE" | "PAUSED"): Promise<{ success: boolean }> {
  return { success: true };
}

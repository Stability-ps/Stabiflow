// Thin client for the Meta Marketing API (Graph API's ads endpoints).
//
// Per Phase 6 instructions #30/#31, this module deliberately separates
// PURE request-payload builders (exported, unit-testable with no network)
// from the actual fetch-performing functions below them. Every test added
// in Phase 6 exercises the builders and the error classifier; no test in
// this repository calls the live Meta API, and no real Meta API call was
// made while building this phase - see the completion report.
//
// Campaigns/ad sets/ads are ALWAYS created with status "PAUSED" - Meta
// never starts spending the instant an object is created; StabiFlow's own
// publish flow explicitly activates only after every object is created
// successfully (see _shared/adPublishExecution.ts), so a partial failure
// (e.g. ad creation fails after the campaign was created) can never result
// in unattended spend.
import { classifyAdNetworkError, classifyMetaAdsError } from "./metaAdsErrorClassifier.ts";
import type {
  CreateAdCreativeInput,
  CreateAdInput,
  CreateAdSetInput,
  CreateCampaignInput,
  CreatedObject,
  InsightsRow,
  MetaCredential,
} from "./types.ts";

export function graphApiBaseUrl(apiVersion: string): string {
  return `https://graph.facebook.com/${apiVersion}`;
}

// --- Pure payload builders (unit tested) -----------------------------------

export function buildCreateCampaignPayload(input: CreateCampaignInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: input.name,
    objective: input.objective,
    status: input.status,
    buying_type: input.buyingType,
    special_ad_categories: input.specialAdCategories && input.specialAdCategories.length ? input.specialAdCategories : [],
  };
  if (input.budgetType === "daily" && input.dailyBudgetMinorUnits != null) {
    payload.daily_budget = String(input.dailyBudgetMinorUnits);
  }
  if (input.budgetType === "lifetime" && input.lifetimeBudgetMinorUnits != null) {
    payload.lifetime_budget = String(input.lifetimeBudgetMinorUnits);
  }
  return payload;
}

export function buildCreateAdSetPayload(input: CreateAdSetInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: input.name,
    campaign_id: input.campaignExternalId,
    status: input.status,
    optimization_goal: input.optimizationGoal,
    billing_event: input.billingEvent,
    start_time: input.startTime,
    targeting: input.targeting,
  };
  if (input.endTime) payload.end_time = input.endTime;
  if (input.dailyBudgetMinorUnits != null) payload.daily_budget = String(input.dailyBudgetMinorUnits);
  if (input.lifetimeBudgetMinorUnits != null) payload.lifetime_budget = String(input.lifetimeBudgetMinorUnits);
  if (Object.keys(input.pagePlacements || {}).length) Object.assign(payload, input.pagePlacements);
  return payload;
}

export function buildCreateAdCreativePayload(input: CreateAdCreativeInput): Record<string, unknown> {
  const linkData: Record<string, unknown> = {
    message: input.primaryText,
    image_url: input.imageUrl,
    call_to_action: { type: input.cta },
  };
  if (input.headline) linkData.name = input.headline;
  if (input.description) linkData.description = input.description;
  if (input.linkOrigin === "website" && input.destinationUrl) linkData.link = input.destinationUrl;
  if (input.linkOrigin === "page_profile") linkData.link = `https://www.facebook.com/${input.pageId}`;

  const objectStorySpec: Record<string, unknown> = { page_id: input.pageId, link_data: linkData };
  if (input.instagramActorId) objectStorySpec.instagram_actor_id = input.instagramActorId;

  return {
    name: input.name,
    object_story_spec: objectStorySpec,
  };
}

export function buildCreateAdPayload(input: CreateAdInput): Record<string, unknown> {
  return {
    name: input.name,
    adset_id: input.adSetExternalId,
    creative: { creative_id: input.creativeExternalId },
    status: input.status,
  };
}

// --- Fetch-performing functions ---------------------------------------------

async function graphRequest<T>(
  cred: MetaCredential,
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
): Promise<T> {
  const url = new URL(`${graphApiBaseUrl(cred.apiVersion)}${path}`);
  let response: Response;
  try {
    if (method === "GET") {
      url.searchParams.set("access_token", cred.token);
      response = await fetch(url.toString(), { method: "GET" });
    } else {
      response = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, access_token: cred.token }),
      });
    }
  } catch (error) {
    classifyAdNetworkError(error);
  }
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok || parsed?.error) {
    classifyMetaAdsError(response.status, parsed);
  }
  return parsed as T;
}

export async function createCampaign(cred: MetaCredential, input: CreateCampaignInput): Promise<CreatedObject> {
  return graphRequest<CreatedObject>(cred, `/${input.adAccountId}/campaigns`, "POST", buildCreateCampaignPayload(input));
}

export async function createAdSet(cred: MetaCredential, input: CreateAdSetInput): Promise<CreatedObject> {
  return graphRequest<CreatedObject>(cred, `/${input.adAccountId}/adsets`, "POST", buildCreateAdSetPayload(input));
}

export async function createAdCreative(cred: MetaCredential, input: CreateAdCreativeInput): Promise<CreatedObject> {
  return graphRequest<CreatedObject>(cred, `/${input.adAccountId}/adcreatives`, "POST", buildCreateAdCreativePayload(input));
}

export async function createAd(cred: MetaCredential, input: CreateAdInput): Promise<CreatedObject> {
  return graphRequest<CreatedObject>(cred, `/${input.adAccountId}/ads`, "POST", buildCreateAdPayload(input));
}

export async function updateObjectStatus(cred: MetaCredential, externalId: string, status: "ACTIVE" | "PAUSED"): Promise<{ success: boolean }> {
  return graphRequest<{ success: boolean }>(cred, `/${externalId}`, "POST", { status });
}

export async function fetchCampaignInsights(cred: MetaCredential, externalCampaignId: string, since: string, until: string): Promise<InsightsRow[]> {
  const fields = "spend,impressions,reach,clicks,ctr,cpc,cpm,frequency,actions,cost_per_action_type";
  const path = `/${externalCampaignId}/insights?fields=${fields}&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}&time_increment=1`;
  const result = await graphRequest<{ data: InsightsRow[] }>(cred, path, "GET");
  return result.data || [];
}

// --- Connection health checks (instruction #10) -----------------------------

export async function checkTokenHealth(cred: MetaCredential): Promise<{ userId: string }> {
  return graphRequest<{ id: string }>(cred, `/me?fields=id`, "GET").then((r) => ({ userId: r.id }));
}

export async function checkAdAccountHealth(cred: MetaCredential, externalAdAccountId: string): Promise<{ id: string; accountStatus: number }> {
  const result = await graphRequest<{ id: string; account_status: number }>(cred, `/${externalAdAccountId}?fields=id,account_status`, "GET");
  return { id: result.id, accountStatus: result.account_status };
}

export async function checkPageHealth(cred: MetaCredential, externalPageId: string): Promise<{ id: string }> {
  return graphRequest<{ id: string }>(cred, `/${externalPageId}?fields=id`, "GET");
}

export async function checkInstagramAccountHealth(cred: MetaCredential, externalIgAccountId: string): Promise<{ id: string }> {
  return graphRequest<{ id: string }>(cred, `/${externalIgAccountId}?fields=id`, "GET");
}

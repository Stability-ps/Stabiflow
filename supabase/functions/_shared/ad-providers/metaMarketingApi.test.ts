// Request-payload tests (Phase 6 instruction #30/#31) - proves what
// StabiFlow WOULD send to the Meta Marketing API, with no network call.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCreateAdCreativePayload,
  buildCreateAdPayload,
  buildCreateAdSetPayload,
  buildCreateCampaignPayload,
} from "./metaMarketingApi.ts";

Deno.test("buildCreateCampaignPayload: daily budget sets daily_budget, never lifetime_budget", () => {
  const payload = buildCreateCampaignPayload({
    adAccountId: "act_123",
    name: "Spring Sale",
    objective: "OUTCOME_TRAFFIC",
    buyingType: "AUCTION",
    status: "PAUSED",
    budgetType: "daily",
    dailyBudgetMinorUnits: 5000,
    lifetimeBudgetMinorUnits: null,
  });
  assertEquals(payload.daily_budget, "5000");
  assertEquals("lifetime_budget" in payload, false);
  assertEquals(payload.status, "PAUSED"); // never created active - see adPublishExecution.ts header comment
});

Deno.test("buildCreateCampaignPayload: lifetime budget sets lifetime_budget, never daily_budget", () => {
  const payload = buildCreateCampaignPayload({
    adAccountId: "act_123",
    name: "Spring Sale",
    objective: "OUTCOME_TRAFFIC",
    buyingType: "AUCTION",
    status: "PAUSED",
    budgetType: "lifetime",
    dailyBudgetMinorUnits: null,
    lifetimeBudgetMinorUnits: 100000,
  });
  assertEquals(payload.lifetime_budget, "100000");
  assertEquals("daily_budget" in payload, false);
});

Deno.test("buildCreateCampaignPayload: special_ad_categories defaults to an empty array, never omitted (Meta requires the field)", () => {
  const payload = buildCreateCampaignPayload({
    adAccountId: "act_123",
    name: "x",
    objective: "OUTCOME_TRAFFIC",
    buyingType: "AUCTION",
    status: "PAUSED",
    budgetType: "daily",
    dailyBudgetMinorUnits: 5000,
    lifetimeBudgetMinorUnits: null,
  });
  assertEquals(payload.special_ad_categories, []);
});

Deno.test("buildCreateAdSetPayload: campaign_id references the parent campaign's EXTERNAL id, not the local uuid", () => {
  const payload = buildCreateAdSetPayload({
    adAccountId: "act_123",
    campaignExternalId: "120210000000001",
    name: "Ad Set",
    status: "PAUSED",
    optimizationGoal: "LINK_CLICKS",
    billingEvent: "LINK_CLICKS",
    startTime: "2026-09-01T00:00:00Z",
    endTime: null,
    targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ["ZA"] } },
    pagePlacements: {},
    dailyBudgetMinorUnits: null,
    lifetimeBudgetMinorUnits: null,
  });
  assertEquals(payload.campaign_id, "120210000000001");
  assertEquals("end_time" in payload, false);
});

Deno.test("buildCreateAdSetPayload: start_time is included for a scheduled start", () => {
  const payload = buildCreateAdSetPayload({
    adAccountId: "act_123", campaignExternalId: "1", name: "Ad Set", status: "PAUSED",
    optimizationGoal: "LINK_CLICKS", billingEvent: "LINK_CLICKS",
    startTime: "2026-09-01T14:30:00Z", endTime: null,
    targeting: {}, pagePlacements: {}, dailyBudgetMinorUnits: null, lifetimeBudgetMinorUnits: null,
  });
  assertEquals(payload.start_time, "2026-09-01T14:30:00Z");
});

Deno.test("START NOW: buildCreateAdSetPayload OMITS start_time when startTime is null (Meta begins delivery on activation)", () => {
  const payload = buildCreateAdSetPayload({
    adAccountId: "act_123", campaignExternalId: "1", name: "Ad Set", status: "PAUSED",
    optimizationGoal: "LINK_CLICKS", billingEvent: "LINK_CLICKS",
    startTime: null, endTime: null,
    targeting: {}, pagePlacements: {}, dailyBudgetMinorUnits: null, lifetimeBudgetMinorUnits: null,
  });
  assertEquals("start_time" in payload, false);
});

Deno.test("buildCreateAdSetPayload: end_time is included only when set", () => {
  const payload = buildCreateAdSetPayload({
    adAccountId: "act_123",
    campaignExternalId: "1",
    name: "Ad Set",
    status: "PAUSED",
    optimizationGoal: "LINK_CLICKS",
    billingEvent: "LINK_CLICKS",
    startTime: "2026-09-01T00:00:00Z",
    endTime: "2026-09-30T00:00:00Z",
    targeting: {},
    pagePlacements: {},
    dailyBudgetMinorUnits: null,
    lifetimeBudgetMinorUnits: null,
  });
  assertEquals(payload.end_time, "2026-09-30T00:00:00Z");
});

Deno.test("buildCreateAdCreativePayload: website destination sets link to the destination URL", () => {
  const payload = buildCreateAdCreativePayload({
    adAccountId: "act_123",
    name: "Creative",
    pageId: "page1",
    instagramActorId: null,
    imageUrl: "https://signed.example.com/img.jpg",
    primaryText: "Shop now!",
    headline: "Spring Sale",
    description: null,
    cta: "SHOP_NOW",
    destinationUrl: "https://example.com/sale",
    linkOrigin: "website",
  });
  const spec = payload.object_story_spec as { link_data: { link?: string; call_to_action: { type: string } } };
  assertEquals(spec.link_data.link, "https://example.com/sale");
  assertEquals(spec.link_data.call_to_action.type, "SHOP_NOW");
});

Deno.test("buildCreateAdCreativePayload: page_profile destination links to the Page itself, ignoring any destination_url", () => {
  const payload = buildCreateAdCreativePayload({
    adAccountId: "act_123",
    name: "Creative",
    pageId: "1234567",
    instagramActorId: null,
    imageUrl: "https://signed.example.com/img.jpg",
    primaryText: "Follow us!",
    headline: null,
    description: null,
    cta: "LEARN_MORE",
    destinationUrl: "https://should-be-ignored.example.com",
    linkOrigin: "page_profile",
  });
  const spec = payload.object_story_spec as { link_data: { link?: string } };
  assertEquals(spec.link_data.link, "https://www.facebook.com/1234567");
});

Deno.test("buildCreateAdCreativePayload: instagram_actor_id is included only when an Instagram account is connected", () => {
  const withIg = buildCreateAdCreativePayload({
    adAccountId: "act_123",
    name: "Creative",
    pageId: "page1",
    instagramActorId: "ig1",
    imageUrl: "https://x.example.com/i.jpg",
    primaryText: "Text",
    headline: null,
    description: null,
    cta: "LEARN_MORE",
    destinationUrl: "https://example.com",
    linkOrigin: "website",
  });
  const specWithIg = withIg.object_story_spec as { instagram_actor_id?: string };
  assertEquals(specWithIg.instagram_actor_id, "ig1");

  const withoutIg = buildCreateAdCreativePayload({
    adAccountId: "act_123",
    name: "Creative",
    pageId: "page1",
    instagramActorId: null,
    imageUrl: "https://x.example.com/i.jpg",
    primaryText: "Text",
    headline: null,
    description: null,
    cta: "LEARN_MORE",
    destinationUrl: "https://example.com",
    linkOrigin: "website",
  });
  const specWithoutIg = withoutIg.object_story_spec as Record<string, unknown>;
  assertEquals("instagram_actor_id" in specWithoutIg, false);
});

Deno.test("buildCreateAdPayload: creative is referenced by its EXTERNAL creative id, and the ad is always created PAUSED", () => {
  const payload = buildCreateAdPayload({
    adAccountId: "act_123",
    adSetExternalId: "adset1",
    creativeExternalId: "creative1",
    name: "Ad",
    status: "PAUSED",
  });
  assertEquals(payload.creative, { creative_id: "creative1" });
  assertEquals(payload.adset_id, "adset1");
  assertEquals(payload.status, "PAUSED");
});

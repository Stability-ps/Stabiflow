import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkCampaignReadiness, isReady, type ReadinessInput } from "./adReadiness.ts";

function baseInput(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    campaign: {
      name: "Spring Sale",
      objective: "OUTCOME_TRAFFIC",
      destinationType: "website",
      budgetType: "daily",
      dailyBudgetMinorUnits: 5000,
      lifetimeBudgetMinorUnits: null,
      currency: "ZAR",
      startAt: "2026-09-05T00:00:00Z", // comfortably after the pinned `now` below
      endAt: null,
      draftCreativeId: "11111111-1111-1111-1111-111111111111",
      facebookPageId: "22222222-2222-2222-2222-222222222222",
      instagramAccountId: null,
    },
    integration: { status: "connected" },
    adAccount: { isActive: true, currency: "ZAR" },
    facebookPage: { isActive: true },
    instagramAccount: null,
    creative: {
      primaryText: "Come shop our spring sale!",
      cta: "SHOP_NOW",
      destinationUrl: "https://example.com/sale",
      mediaWidthPx: 1200,
      mediaHeightPx: 1200,
      mediaMimeType: "image/jpeg",
      whatsappNumberId: null,
    },
    whatsappNumber: null,
    tokenHealthy: true,
    timezone: "Africa/Johannesburg",
    now: new Date("2026-08-29T10:00:00Z"),
    ...overrides,
  };
}

Deno.test("a fully valid campaign is ready with zero issues", () => {
  const issues = checkCampaignReadiness(baseInput());
  assertEquals(issues, []);
  assertEquals(isReady(issues), true);
});

Deno.test("missing integration is an error", () => {
  const issues = checkCampaignReadiness(baseInput({ integration: null }));
  assertEquals(issues.some((i) => i.code === "missing_integration"), true);
  assertEquals(isReady(issues), false);
});

Deno.test("disconnected integration is an error", () => {
  const issues = checkCampaignReadiness(baseInput({ integration: { status: "error" } }));
  assertEquals(issues.some((i) => i.code === "integration_not_connected"), true);
});

Deno.test("missing ad account is an error", () => {
  const issues = checkCampaignReadiness(baseInput({ adAccount: null }));
  assertEquals(issues.some((i) => i.code === "missing_ad_account"), true);
});

Deno.test("inactive ad account is an error", () => {
  const issues = checkCampaignReadiness(baseInput({ adAccount: { isActive: false, currency: "ZAR" } }));
  assertEquals(issues.some((i) => i.code === "ad_account_inactive"), true);
});

Deno.test("currency mismatch between campaign and ad account is flagged, never silently converted", () => {
  const issues = checkCampaignReadiness(baseInput({ adAccount: { isActive: true, currency: "USD" } }));
  assertEquals(issues.some((i) => i.code === "currency_mismatch"), true);
});

Deno.test("unsupported objective is rejected outright", () => {
  const issues = checkCampaignReadiness(baseInput({ campaign: { ...baseInput().campaign, objective: "OUTCOME_LEADS" } }));
  assertEquals(issues.some((i) => i.code === "unsupported_objective"), true);
});

Deno.test("a destination type not allowed for the objective is rejected", () => {
  const issues = checkCampaignReadiness(
    baseInput({ campaign: { ...baseInput().campaign, objective: "OUTCOME_ENGAGEMENT", destinationType: "website" } }),
  );
  assertEquals(issues.some((i) => i.code === "invalid_destination_for_objective"), true);
});

Deno.test("missing creative is an error", () => {
  const issues = checkCampaignReadiness(baseInput({ creative: null, campaign: { ...baseInput().campaign, draftCreativeId: null } }));
  assertEquals(issues.some((i) => i.code === "missing_creative"), true);
});

Deno.test("a CTA not allowed for the objective is rejected", () => {
  const issues = checkCampaignReadiness(baseInput({ creative: { ...baseInput().creative!, cta: "DONATE_NOW" } }));
  assertEquals(issues.some((i) => i.code === "cta_not_allowed_for_objective"), true);
});

Deno.test("website destination without a destination URL is an error", () => {
  const issues = checkCampaignReadiness(baseInput({ creative: { ...baseInput().creative!, destinationUrl: null } }));
  assertEquals(issues.some((i) => i.code === "missing_destination_url"), true);
});

Deno.test("invalid budget shape surfaces as an issue (delegates to adMoney)", () => {
  const issues = checkCampaignReadiness(
    baseInput({ campaign: { ...baseInput().campaign, budgetType: "daily", dailyBudgetMinorUnits: null } }),
  );
  assertEquals(issues.some((i) => i.code === "invalid_budget"), true);
});

Deno.test("undersized creative media is a WARNING, not a blocking error", () => {
  const issues = checkCampaignReadiness(baseInput({ creative: { ...baseInput().creative!, mediaWidthPx: 200, mediaHeightPx: 200 } }));
  const issue = issues.find((i) => i.code === "creative_media_too_small");
  assertEquals(issue?.severity, "warning");
  assertEquals(isReady(issues), true); // warnings alone don't block readiness
});

Deno.test("unsupported creative media type is an error", () => {
  const issues = checkCampaignReadiness(baseInput({ creative: { ...baseInput().creative!, mediaMimeType: "video/mp4" } }));
  assertEquals(issues.some((i) => i.code === "unsupported_creative_media_type"), true);
});

Deno.test("an unhealthy token surfaces as its own issue", () => {
  const issues = checkCampaignReadiness(baseInput({ tokenHealthy: false }));
  assertEquals(issues.some((i) => i.code === "token_unhealthy"), true);
});

Deno.test("tokenHealthy=null (not checked) produces no token issue - readiness never claims to have checked what it didn't", () => {
  const issues = checkCampaignReadiness(baseInput({ tokenHealthy: null }));
  assertEquals(issues.some((i) => i.code === "token_unhealthy"), false);
});

Deno.test("REGRESSION: a start date of TODAY in the workspace timezone does NOT produce an 'in the past' issue", () => {
  // start_at stored as JHB local midnight for 2026-08-29 -> 2026-08-28T22:00Z,
  // which as an instant is 12h before the pinned now (2026-08-29 10:00Z /
  // 12:00 JHB). Calendar-date comparison in JHB: 2026-08-29 == 2026-08-29.
  const issues = checkCampaignReadiness(
    baseInput({ campaign: { ...baseInput().campaign, startAt: "2026-08-28T22:00:00Z" } }),
  );
  assertEquals(issues.some((i) => i.code === "invalid_budget" && i.message.includes("start date must not be in the past")), false);
  assertEquals(isReady(issues), true);
});

Deno.test("a start date that is genuinely yesterday in the workspace timezone still blocks readiness", () => {
  const issues = checkCampaignReadiness(
    baseInput({ campaign: { ...baseInput().campaign, startAt: "2026-08-27T22:00:00Z" } }), // 2026-08-28 00:00 JHB, now is the 29th
  );
  assertEquals(issues.some((i) => i.code === "invalid_budget" && i.message.includes("start date must not be in the past")), true);
  assertEquals(isReady(issues), false);
});

Deno.test("timezone defaults to UTC when the caller resolves none", () => {
  // No `timezone` -> UTC. start 2026-08-29 00:00Z, now 2026-08-29 10:00Z: same UTC day -> allowed.
  const issues = checkCampaignReadiness(
    baseInput({ timezone: undefined, campaign: { ...baseInput().campaign, startAt: "2026-08-29T00:00:00Z" } }),
  );
  assertEquals(issues.some((i) => i.message.includes("start date must not be in the past")), false);
});

Deno.test("isReady is false if ANY error-severity issue exists, regardless of warnings", () => {
  const issues = [
    { code: "warn", message: "w", severity: "warning" as const },
    { code: "err", message: "e", severity: "error" as const },
  ];
  assertEquals(isReady(issues), false);
});

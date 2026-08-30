// Pre-publish readiness validation (Phase 6 instruction #9). Pure function
// over already-resolved data - the calling edge function
// (ad-campaigns-readiness/index.ts, and ad-campaigns-publish/index.ts
// before it does anything) is responsible for fetching every referenced
// row; this module only judges what it's handed, which is what makes it
// exhaustively unit-testable without a database or network call.
//
// "Return clear issues. Do not promise Meta approval" (instruction #9): a
// campaign can be locally 'ready' and still be rejected or sent to manual
// review by Meta - this function only proves StabiFlow's own side is
// internally consistent and complete, never that Meta will accept it.
import { isCtaAllowed, isDestinationTypeAllowed, isSupportedObjective } from "./adObjectiveRules.ts";
import { validateCampaignBudget } from "./adMoney.ts";

export type ReadinessIssue = {
  code: string;
  message: string;
  severity: "error" | "warning";
};

export type ReadinessInput = {
  campaign: {
    name: string;
    objective: string;
    destinationType: string;
    budgetType: "daily" | "lifetime";
    dailyBudgetMinorUnits: number | null;
    lifetimeBudgetMinorUnits: number | null;
    currency: string;
    startAt: string;
    endAt: string | null;
    draftCreativeId: string | null;
    facebookPageId: string | null;
    instagramAccountId: string | null;
  };
  integration: { status: string } | null;
  adAccount: { isActive: boolean; currency: string | null } | null;
  facebookPage: { isActive: boolean } | null;
  instagramAccount: { isActive: boolean } | null;
  creative: {
    primaryText: string | null;
    cta: string | null;
    destinationUrl: string | null;
    mediaWidthPx: number | null;
    mediaHeightPx: number | null;
    mediaMimeType: string | null;
    whatsappNumberId: string | null;
  } | null;
  whatsappNumber: { isActive: boolean } | null;
  tokenHealthy: boolean | null; // null = not checked (readiness check without a live provider call)
  // IANA timezone (workspace_settings.timezone) the schedule is authored
  // in - the start-date check is a calendar-date comparison in this zone so
  // a start date of *today* is not wrongly rejected as past. Defaults to
  // "UTC" when the caller doesn't resolve one.
  timezone?: string;
  now?: Date; // injected clock, for deterministic tests
};

// Meta's documented minimum for a standard feed image ad. Not exhaustive
// (Stories/Reels have their own minimums) - a documented, conservative
// floor rather than a promise Meta will accept any image that passes it.
const MIN_CREATIVE_WIDTH_PX = 600;
const MIN_CREATIVE_HEIGHT_PX = 600;
const SUPPORTED_CREATIVE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

export function checkCampaignReadiness(input: ReadinessInput): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  const push = (code: string, message: string, severity: ReadinessIssue["severity"] = "error") => issues.push({ code, message, severity });

  if (!input.campaign.name || !input.campaign.name.trim()) push("missing_name", "Campaign name is required.");

  if (!isSupportedObjective(input.campaign.objective)) {
    push("unsupported_objective", `Objective "${input.campaign.objective}" is not currently supported.`);
  } else if (!isDestinationTypeAllowed(input.campaign.objective, input.campaign.destinationType)) {
    push("invalid_destination_for_objective", `Destination type "${input.campaign.destinationType}" is not valid for this objective.`);
  }

  if (!input.integration) {
    push("missing_integration", "No connected Meta integration was found for this workspace.");
  } else if (input.integration.status !== "connected") {
    push("integration_not_connected", "This workspace's Meta integration is not connected.");
  }

  if (!input.adAccount) {
    push("missing_ad_account", "No connected Meta Ad Account was found for this workspace.");
  } else if (!input.adAccount.isActive) {
    push("ad_account_inactive", "The selected Meta Ad Account is not active.");
  } else if (input.adAccount.currency && input.adAccount.currency !== input.campaign.currency) {
    push(
      "currency_mismatch",
      `Campaign currency (${input.campaign.currency}) does not match the ad account's currency (${input.adAccount.currency}). StabiFlow does not convert currency automatically.`,
    );
  }

  if (input.campaign.destinationType === "page_profile" || input.campaign.objective === "OUTCOME_ENGAGEMENT" || input.campaign.objective === "OUTCOME_AWARENESS") {
    if (!input.campaign.facebookPageId && !input.campaign.instagramAccountId) {
      push("missing_page_or_instagram", "A connected Facebook Page or Instagram account is required for this objective.");
    }
  }
  if (input.campaign.facebookPageId && (!input.facebookPage || !input.facebookPage.isActive)) {
    push("facebook_page_inactive", "The selected Facebook Page is not connected or not active.");
  }
  if (input.campaign.instagramAccountId && (!input.instagramAccount || !input.instagramAccount.isActive)) {
    push("instagram_account_inactive", "The selected Instagram account is not connected or not active.");
  }

  const budgetValidation = validateCampaignBudget({
    budgetType: input.campaign.budgetType,
    dailyBudgetMinorUnits: input.campaign.dailyBudgetMinorUnits,
    lifetimeBudgetMinorUnits: input.campaign.lifetimeBudgetMinorUnits,
    currency: input.campaign.currency,
    startAt: new Date(input.campaign.startAt),
    endAt: input.campaign.endAt ? new Date(input.campaign.endAt) : null,
    timezone: input.timezone || "UTC",
    now: input.now,
  });
  if (!budgetValidation.valid) {
    for (const issue of budgetValidation.issues) push("invalid_budget", issue);
  }

  if (!input.campaign.draftCreativeId || !input.creative) {
    push("missing_creative", "A creative (media, text, and call to action) is required.");
  } else {
    if (!input.creative.primaryText || !input.creative.primaryText.trim()) push("missing_creative_text", "Creative primary text is required.");
    if (!input.creative.cta) push("missing_cta", "A call-to-action is required.");
    else if (isSupportedObjective(input.campaign.objective) && !isCtaAllowed(input.campaign.objective, input.creative.cta)) {
      push("cta_not_allowed_for_objective", `Call-to-action "${input.creative.cta}" is not valid for this objective.`);
    }
    if (input.campaign.destinationType === "website" && !input.creative.destinationUrl) {
      push("missing_destination_url", "A destination URL is required for a website destination.");
    }
    if (input.campaign.destinationType === "whatsapp") {
      if (!input.creative.whatsappNumberId) {
        push("missing_whatsapp_number", "A WhatsApp number is required for a WhatsApp destination.");
      } else if (!input.whatsappNumber || !input.whatsappNumber.isActive) {
        push("whatsapp_number_inactive", "The selected WhatsApp number is not connected or not active.");
      }
    }
    if (input.creative.mediaMimeType && !SUPPORTED_CREATIVE_MIME_TYPES.has(input.creative.mediaMimeType)) {
      push("unsupported_creative_media_type", `Media type "${input.creative.mediaMimeType}" is not supported for ads.`);
    }
    if (
      input.creative.mediaWidthPx != null &&
      input.creative.mediaHeightPx != null &&
      (input.creative.mediaWidthPx < MIN_CREATIVE_WIDTH_PX || input.creative.mediaHeightPx < MIN_CREATIVE_HEIGHT_PX)
    ) {
      push(
        "creative_media_too_small",
        `Media must be at least ${MIN_CREATIVE_WIDTH_PX}x${MIN_CREATIVE_HEIGHT_PX}px (got ${input.creative.mediaWidthPx}x${input.creative.mediaHeightPx}).`,
        "warning",
      );
    }
  }

  if (input.tokenHealthy === false) {
    push("token_unhealthy", "This workspace's Meta access token appears to be invalid or expired. Reconnect in Integrations.");
  }

  return issues;
}

export function isReady(issues: ReadinessIssue[]): boolean {
  return issues.every((i) => i.severity !== "error");
}

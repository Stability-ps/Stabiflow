import type { DestinationType, SupportedObjective } from "@/lib/adObjectives";

export const CAMPAIGN_BUILDER_STEPS = ["Goal", "Ad Account", "Audience", "Budget & Schedule", "Creative", "Review", "Publish"] as const;

export type CampaignBuilderStep = (typeof CAMPAIGN_BUILDER_STEPS)[number];

export type CampaignBuilderValidationIssue = {
  code: string;
  field: string;
  message: string;
  step: CampaignBuilderStep;
  stepIndex: number;
};

export type CampaignBuilderValidationInput = {
  name: string;
  objective: SupportedObjective | "";
  integrationId: string | null;
  adAccountId: string;
  adAccountIsUsable: boolean;
  facebookPageId: string;
  instagramAccountId: string;
  pageOrInstagramIsUsable: boolean;
  destinationType: DestinationType | "";
  ageMin: number;
  ageMax: number;
  geoCountries: string[];
  budgetType: "daily" | "lifetime";
  budgetDecimal: string;
  startAt: string;
  endAt: string;
  mediaAssetId: string;
  mediaAssetIsUsable: boolean;
  primaryText: string;
  cta: string;
  allowedCtas: string[];
  destinationUrl: string;
  whatsappNumberId: string;
  whatsappNumberIsUsable: boolean;
};

const add = (
  issues: CampaignBuilderValidationIssue[],
  step: CampaignBuilderStep,
  field: string,
  code: string,
  message: string,
) => issues.push({ code, field, message, step, stepIndex: CAMPAIGN_BUILDER_STEPS.indexOf(step) });

export function validateCampaignBuilder(input: CampaignBuilderValidationInput): CampaignBuilderValidationIssue[] {
  const issues: CampaignBuilderValidationIssue[] = [];

  if (!input.name.trim()) add(issues, "Goal", "name", "missing_name", "Campaign name is required.");
  if (!input.objective) add(issues, "Goal", "objective", "missing_objective", "Choose the campaign objective.");

  if (!input.integrationId) add(issues, "Ad Account", "integration", "missing_integration", "Connect a Meta account before creating a campaign.");
  if (!input.adAccountId) add(issues, "Ad Account", "adAccountId", "missing_ad_account", "Choose a Meta ad account.");
  else if (!input.adAccountIsUsable) add(issues, "Ad Account", "adAccountId", "inactive_ad_account", "Choose an active Meta ad account.");
  if (!input.destinationType) add(issues, "Ad Account", "destinationType", "missing_destination", "Choose a destination.");
  if (
    (input.destinationType === "page_profile" || input.objective === "OUTCOME_AWARENESS" || input.objective === "OUTCOME_ENGAGEMENT") &&
    !input.pageOrInstagramIsUsable
  ) {
    add(issues, "Ad Account", "pageOrInstagram", "missing_page_or_instagram", "Choose a Facebook Page or Instagram account.");
  }

  if (!Number.isInteger(input.ageMin) || input.ageMin < 13 || input.ageMin > 65) {
    add(issues, "Audience", "ageMin", "invalid_minimum_age", "Minimum age must be between 13 and 65.");
  }
  if (!Number.isInteger(input.ageMax) || input.ageMax < 13 || input.ageMax > 65) {
    add(issues, "Audience", "ageMax", "invalid_maximum_age", "Maximum age must be between 13 and 65.");
  }
  if (Number.isFinite(input.ageMin) && Number.isFinite(input.ageMax) && input.ageMin > input.ageMax) {
    add(issues, "Audience", "ageRange", "invalid_age_range", "Maximum age must be greater than or equal to minimum age.");
  }
  if (input.geoCountries.length === 0) {
    add(issues, "Audience", "geoCountries", "missing_geo_country", "Add at least one country to the audience.");
  } else if (input.geoCountries.some((country) => !/^[A-Z]{2}$/.test(country))) {
    add(issues, "Audience", "geoCountries", "invalid_geo_country", "Use two-letter ISO country codes, separated by commas.");
  }

  const budget = Number(input.budgetDecimal);
  if (!Number.isFinite(budget) || budget < 1) {
    add(issues, "Budget & Schedule", "budgetDecimal", "invalid_budget", "Budget must be at least 1.00.");
  }
  if (!input.startAt) {
    add(issues, "Budget & Schedule", "startAt", "missing_start_date", "Choose a start date.");
  } else {
    const now = new Date();
    const localToday = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    if (input.startAt < localToday) {
      add(issues, "Budget & Schedule", "startAt", "start_date_in_past", "Start date must not be in the past.");
    }
  }
  if (input.budgetType === "lifetime" && !input.endAt) {
    add(issues, "Budget & Schedule", "endAt", "missing_end_date", "Choose an end date for a lifetime budget.");
  }
  if (input.startAt && input.endAt && input.endAt <= input.startAt) {
    add(issues, "Budget & Schedule", "endAt", "invalid_end_date", "End date must be after the start date.");
  }

  if (!input.mediaAssetId || !input.mediaAssetIsUsable) {
    add(issues, "Creative", "mediaAssetId", "missing_media", "Media is required.");
  }
  if (!input.primaryText.trim()) add(issues, "Creative", "primaryText", "missing_primary_text", "Primary text is required.");
  if (!input.cta) {
    add(issues, "Creative", "cta", "missing_cta", "Select a call to action.");
  } else if (!input.allowedCtas.includes(input.cta)) {
    add(issues, "Creative", "cta", "invalid_cta", "Choose a call to action supported by this objective.");
  }
  if (input.destinationType === "website") {
    if (!input.destinationUrl.trim()) {
      add(issues, "Creative", "destinationUrl", "missing_destination_url", "Destination URL is required.");
    } else {
      try {
        const url = new URL(input.destinationUrl.trim());
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
      } catch {
        add(issues, "Creative", "destinationUrl", "invalid_destination_url", "Enter a valid http or https destination URL.");
      }
    }
  }
  if (input.destinationType === "whatsapp") {
    if (!input.whatsappNumberId) {
      add(issues, "Creative", "whatsappNumberId", "missing_whatsapp_number", "Choose a WhatsApp number.");
    } else if (!input.whatsappNumberIsUsable) {
      add(issues, "Creative", "whatsappNumberId", "inactive_whatsapp_number", "Choose an active WhatsApp number.");
    }
  }

  return issues;
}

export function issuesForStep(issues: CampaignBuilderValidationIssue[], step: CampaignBuilderStep) {
  return issues.filter((issue) => issue.step === step);
}

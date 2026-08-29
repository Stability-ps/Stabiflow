import { describe, expect, it } from "vitest";
import { validateCampaignBuilder, type CampaignBuilderValidationInput } from "./campaignBuilderValidation";

function validInput(overrides: Partial<CampaignBuilderValidationInput> = {}): CampaignBuilderValidationInput {
  return {
    name: "Launch Q4",
    objective: "OUTCOME_TRAFFIC",
    integrationId: "integration-1",
    adAccountId: "account-1",
    adAccountIsUsable: true,
    facebookPageId: "",
    instagramAccountId: "",
    pageOrInstagramIsUsable: false,
    destinationType: "website",
    ageMin: 18,
    ageMax: 65,
    geoCountries: ["ZA"],
    budgetType: "daily",
    budgetDecimal: "100.00",
    startAt: "2099-01-01",
    endAt: "",
    mediaAssetId: "asset-1",
    mediaAssetIsUsable: true,
    primaryText: "Book a demo",
    cta: "SHOP_NOW",
    allowedCtas: ["LEARN_MORE", "SHOP_NOW", "SIGN_UP", "WHATSAPP_MESSAGE"],
    destinationUrl: "https://stabiflow.com/demo",
    whatsappNumberId: "",
    whatsappNumberIsUsable: false,
    ...overrides,
  };
}

describe("validateCampaignBuilder", () => {
  it("returns no issues for a complete supported campaign", () => {
    expect(validateCampaignBuilder(validInput())).toEqual([]);
  });

  it("assigns exact missing-field messages to their owning steps", () => {
    const issues = validateCampaignBuilder(validInput({
      name: "",
      adAccountId: "",
      geoCountries: [],
      mediaAssetId: "",
      mediaAssetIsUsable: false,
      primaryText: "",
    }));

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing_name", message: "Campaign name is required.", step: "Goal" }),
      expect.objectContaining({ code: "missing_ad_account", message: "Choose a Meta ad account.", step: "Ad Account" }),
      expect.objectContaining({ code: "missing_geo_country", message: "Add at least one country to the audience.", step: "Audience" }),
      expect.objectContaining({ code: "missing_media", message: "Media is required.", step: "Creative" }),
      expect.objectContaining({ code: "missing_primary_text", message: "Primary text is required.", step: "Creative" }),
    ]));
  });

  it("validates audience ranges, lifetime schedule, URL, and objective CTA", () => {
    const issues = validateCampaignBuilder(validInput({
      ageMin: 66,
      ageMax: 17,
      geoCountries: ["SOUTH AFRICA"],
      budgetType: "lifetime",
      endAt: "",
      destinationUrl: "javascript:alert(1)",
      cta: "DONATE_NOW",
    }));

    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "invalid_minimum_age",
      "invalid_age_range",
      "invalid_geo_country",
      "missing_end_date",
      "invalid_destination_url",
      "invalid_cta",
    ]));
  });

  it("requires a Page or Instagram account when the publish rules require one", () => {
    const issues = validateCampaignBuilder(validInput({ objective: "OUTCOME_AWARENESS", cta: "LEARN_MORE", allowedCtas: ["LEARN_MORE"] }));
    expect(issues).toContainEqual(expect.objectContaining({ code: "missing_page_or_instagram", step: "Ad Account" }));
  });
});

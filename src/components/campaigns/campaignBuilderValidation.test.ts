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
    startMode: "scheduled",
    startAt: "2099-01-01",
    startTime: "09:00",
    endAt: "",
    endTime: "",
    timezone: "Africa/Johannesburg",
    now: new Date("2026-08-30T12:00:00Z"),
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

  describe("scheduling (timezone-aware date + time, or Start now)", () => {
    const NOW = new Date("2026-08-30T12:00:00Z"); // 14:00 Africa/Johannesburg

    it("Start now needs no start date/time and is always valid", () => {
      const issues = validateCampaignBuilder(validInput({ startMode: "now", startAt: "", startTime: "", now: NOW }));
      expect(issues.filter((i) => i.step === "Budget & Schedule")).toEqual([]);
    });

    it("a scheduled start later the same day is valid (no calendar-date-only rule)", () => {
      // 18:00 JHB today -> future instant
      const issues = validateCampaignBuilder(validInput({ startMode: "scheduled", startAt: "2026-08-30", startTime: "18:00", now: NOW }));
      expect(issues.filter((i) => i.step === "Budget & Schedule")).toEqual([]);
    });

    it("a scheduled start one minute in the future is valid - there is no minimum buffer", () => {
      // NOW is 14:00 JHB; 14:01 JHB is 12:01Z
      const issues = validateCampaignBuilder(validInput({ startMode: "scheduled", startAt: "2026-08-30", startTime: "14:01", now: NOW }));
      expect(issues.some((i) => i.code === "start_in_past")).toBe(false);
    });

    it("a scheduled start earlier today is rejected as 'Scheduled start time must be in the future.'", () => {
      const issues = validateCampaignBuilder(validInput({ startMode: "scheduled", startAt: "2026-08-30", startTime: "13:00", now: NOW }));
      expect(issues).toContainEqual(expect.objectContaining({ code: "start_in_past", field: "startAt", step: "Budget & Schedule" }));
    });

    it("a scheduled start on a future date is valid", () => {
      const issues = validateCampaignBuilder(validInput({ startMode: "scheduled", startAt: "2026-09-15", startTime: "09:00", now: NOW }));
      expect(issues.filter((i) => i.step === "Budget & Schedule")).toEqual([]);
    });

    it("end must be after the scheduled start", () => {
      const issues = validateCampaignBuilder(validInput({
        startMode: "scheduled", startAt: "2026-09-15", startTime: "09:00", endAt: "2026-09-15", endTime: "09:00", now: NOW,
      }));
      expect(issues).toContainEqual(expect.objectContaining({ code: "invalid_end_date", step: "Budget & Schedule" }));
    });

    it("Start now + an end time in the past is rejected", () => {
      const issues = validateCampaignBuilder(validInput({ startMode: "now", startAt: "", startTime: "", endAt: "2026-08-29", endTime: "10:00", now: NOW }));
      expect(issues).toContainEqual(expect.objectContaining({ code: "invalid_end_date", step: "Budget & Schedule" }));
    });

    it("a malformed timezone does not crash - it falls back and still validates", () => {
      const issues = validateCampaignBuilder(validInput({ startMode: "scheduled", startAt: "2026-09-15", startTime: "09:00", timezone: "Not/AZone", now: NOW }));
      expect(Array.isArray(issues)).toBe(true);
      expect(issues.filter((i) => i.step === "Budget & Schedule")).toEqual([]);
    });
  });
});

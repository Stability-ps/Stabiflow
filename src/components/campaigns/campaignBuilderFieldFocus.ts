// Maps a campaignBuilderValidation.ts field key to the DOM element id of
// the actual input control it represents, so a readiness issue (or a
// client-side validation issue) can jump straight to - and focus - the
// exact field that caused it. One id per field key; kept in sync with the
// ids rendered in CampaignBuilder.tsx.
export const CAMPAIGN_BUILDER_FIELD_ELEMENT_IDS: Record<string, string> = {
  name: "campaign-name",
  objective: "campaign-name", // objective picker has no single focusable input; anchor near the top of the Goal step
  integration: "campaign-ad-account",
  adAccountId: "campaign-ad-account",
  facebookPageId: "campaign-facebook-page",
  pageOrInstagram: "campaign-facebook-page",
  instagramAccountId: "campaign-instagram-account",
  destinationType: "campaign-destination",
  ageMin: "audience-age-min",
  ageMax: "audience-age-max",
  ageRange: "audience-age-min",
  geoCountries: "audience-countries",
  budgetDecimal: "campaign-budget",
  startAt: "campaign-start-date",
  endAt: "campaign-end-date",
  mediaAssetId: "campaign-media-picker",
  primaryText: "creative-primary-text",
  cta: "campaign-cta",
  destinationUrl: "campaign-destination-url",
  whatsappNumberId: "campaign-whatsapp-number",
};

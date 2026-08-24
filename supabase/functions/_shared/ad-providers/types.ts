// Provider-agnostic types for the Campaigns module's Meta Marketing API
// calls. Deliberately a SEPARATE error/type hierarchy from
// _shared/content-providers/types.ts even though the shapes rhyme - Phase 6
// instruction #2 is explicit that paid campaigns must stay a clean, distinct
// model from organic Content, and that separation should hold in code, not
// just in table names.

export class TemporaryAdError extends Error {
  code: string;
  category: AdErrorCategory;
  constructor(code: string, message: string, category: AdErrorCategory = "temporary_unavailable") {
    super(message);
    this.name = "TemporaryAdError";
    this.code = code;
    this.category = category;
  }
}

export class PermanentAdError extends Error {
  code: string;
  category: AdErrorCategory;
  constructor(code: string, message: string, category: AdErrorCategory) {
    super(message);
    this.name = "PermanentAdError";
    this.code = code;
    this.category = category;
  }
}

// Actionable error categories (Phase 6 instruction #20). "policy_review" is
// kept distinct from "invalid_creative" because Meta explicitly
// distinguishes ad-review rejections (a human/automated policy decision,
// often not immediately re-triable) from a structurally invalid creative
// payload (a StabiFlow-side bug).
export type AdErrorCategory =
  | "temporary_unavailable"
  | "rate_limited"
  | "expired_token"
  | "authorization_failure"
  | "invalid_resource"
  | "invalid_creative"
  | "invalid_request"
  | "policy_review"
  | "unknown";

export type MetaCredential = {
  token: string;
  apiVersion: string;
};

export type CreateCampaignInput = {
  adAccountId: string; // "act_<id>"
  name: string;
  objective: string;
  buyingType: string;
  status: "PAUSED"; // Campaigns are ALWAYS created paused - see adPublishExecution.ts
  budgetType: "daily" | "lifetime";
  dailyBudgetMinorUnits: number | null;
  lifetimeBudgetMinorUnits: number | null;
  specialAdCategories?: string[];
};

export type CreateAdSetInput = {
  adAccountId: string;
  campaignExternalId: string;
  name: string;
  status: "PAUSED";
  optimizationGoal: string;
  billingEvent: string;
  startTime: string; // ISO
  endTime: string | null;
  targeting: Record<string, unknown>;
  pagePlacements: Record<string, unknown>;
  dailyBudgetMinorUnits: number | null;
  lifetimeBudgetMinorUnits: number | null;
};

export type CreateAdCreativeInput = {
  adAccountId: string;
  name: string;
  pageId: string; // required by Meta for every creative
  instagramActorId: string | null;
  imageUrl: string;
  primaryText: string;
  headline: string | null;
  description: string | null;
  cta: string;
  destinationUrl: string | null;
  linkOrigin: "website" | "page_profile" | "whatsapp";
};

export type CreateAdInput = {
  adAccountId: string;
  adSetExternalId: string;
  creativeExternalId: string;
  name: string;
  status: "PAUSED";
};

export type CreatedObject = { id: string };

export type InsightsRow = {
  date_start: string;
  date_stop: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  frequency?: string;
  currency?: string;
  actions?: Array<{ action_type: string; value: string }>;
  cost_per_action_type?: Array<{ action_type: string; value: string }>;
};

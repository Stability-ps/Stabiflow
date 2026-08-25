// Provider-agnostic types for the Integrations module (Phase C).
//
// Deliberately a SEPARATE error/type hierarchy from
// _shared/ad-providers/types.ts and _shared/content-providers/types.ts,
// even though the shapes rhyme - each module's own header comment already
// establishes "parallel, not shared" classifiers (see
// ad-providers/metaAdsErrorClassifier.ts), and Integrations is the
// FOUNDATION Content/Campaigns build on, not a sibling that should import
// sideways from either of them.

export type IntegrationErrorCategory =
  | "temporary_unavailable"
  | "rate_limited"
  | "expired_token"
  | "authorization_failure"
  | "missing_permission"
  | "invalid_resource"
  | "invalid_request"
  | "unknown";

export class TemporaryIntegrationError extends Error {
  code: string;
  category: IntegrationErrorCategory;
  constructor(code: string, message: string, category: IntegrationErrorCategory = "temporary_unavailable") {
    super(message);
    this.name = "TemporaryIntegrationError";
    this.code = code;
    this.category = category;
  }
}

export class PermanentIntegrationError extends Error {
  code: string;
  category: IntegrationErrorCategory;
  constructor(code: string, message: string, category: IntegrationErrorCategory) {
    super(message);
    this.name = "PermanentIntegrationError";
    this.code = code;
    this.category = category;
  }
}

export type MetaCredential = { token: string; apiVersion: string };

export type DiscoveredFacebookPage = { pageId: string; pageName: string };

export type DiscoveredInstagramAccount = {
  igBusinessAccountId: string;
  username: string | null;
  linkedPageId: string; // provider Page id it was discovered through
};

export type DiscoveredAdAccount = {
  adAccountId: string;
  name: string | null;
  currency: string | null;
  timezone: string | null;
  accountStatus: number | null;
};

export type DiscoveredWabaPhoneNumber = {
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  platformStatus: string | null;
};

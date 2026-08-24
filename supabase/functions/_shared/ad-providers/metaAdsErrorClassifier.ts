// Meta Marketing API error classification (Phase 6 instruction #20).
// Ads-specific: the Marketing API returns the same top-level error envelope
// as the Graph API used by _shared/content-providers/metaErrorClassifier.ts,
// but the actionable categories differ (creative/policy rejection has no
// equivalent in organic post publishing), so this is a parallel, not
// shared, classifier - consistent with keeping paid campaigns a clean,
// separate model from organic Content (instruction #2).
//
// Code mapping below is a best-effort classification assembled from Meta's
// published Graph API error code reference
// (developers.facebook.com/docs/graph-api/guides/error-handling) and the
// Marketing API's documented ad-review/creative error subcodes. It has NOT
// been validated against a live ad account (Phase 6 makes no real Meta API
// calls - see the completion report). Before any real spend-capable
// campaign is published, re-verify these codes against the current Graph
// API version's actual error responses.
import { PermanentAdError, TemporaryAdError, type AdErrorCategory } from "./types.ts";

type MetaErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
    fbtrace_id?: string;
  };
};

const RATE_LIMITED_CODES = new Set([4, 17, 32, 613]);
const TEMPORARY_CODES = new Set([1, 2]);
const EXPIRED_TOKEN_CODES = new Set([190]);
const AUTHORIZATION_CODES = new Set([10, 200, 299]);
const INVALID_REQUEST_CODES = new Set([100]);
// Ad-review / creative rejection subcodes Meta documents for the Marketing
// API (policy violation, disapproved creative, invalid creative payload).
const INVALID_CREATIVE_SUBCODES = new Set([1487941, 1815656, 2018064, 1885212]);
const POLICY_SUBCODES = new Set([1487742]);

export function classifyMetaAdsError(httpStatus: number, body: MetaErrorBody): never {
  const error = body?.error || {};
  const code = typeof error.code === "number" ? error.code : null;
  const subcode = typeof error.error_subcode === "number" ? error.error_subcode : null;
  const message = error.error_user_msg || error.message || `Meta Marketing API request failed (${httpStatus})`;
  const codeLabel = code !== null ? `meta_${code}${subcode !== null ? `_${subcode}` : ""}` : `http_${httpStatus}`;

  if (subcode !== null && POLICY_SUBCODES.has(subcode)) {
    throw new PermanentAdError(codeLabel, message, "policy_review");
  }
  if (subcode !== null && INVALID_CREATIVE_SUBCODES.has(subcode)) {
    throw new PermanentAdError(codeLabel, message, "invalid_creative");
  }
  if (httpStatus >= 500) {
    throw new TemporaryAdError(codeLabel, message, "temporary_unavailable");
  }
  if (code !== null && RATE_LIMITED_CODES.has(code)) {
    throw new TemporaryAdError(codeLabel, message, "rate_limited");
  }
  if (code !== null && TEMPORARY_CODES.has(code)) {
    throw new TemporaryAdError(codeLabel, message, "temporary_unavailable");
  }
  if (code !== null && EXPIRED_TOKEN_CODES.has(code)) {
    throw new PermanentAdError(codeLabel, message, "expired_token");
  }
  if (code !== null && AUTHORIZATION_CODES.has(code)) {
    throw new PermanentAdError(codeLabel, message, "authorization_failure");
  }
  if (code !== null && INVALID_REQUEST_CODES.has(code)) {
    throw new PermanentAdError(codeLabel, message, "invalid_request");
  }
  if (httpStatus === 404) {
    throw new PermanentAdError(codeLabel, message, "invalid_resource");
  }
  // Unknown 4xx: permanent by default, same reasoning as the content
  // classifier - retrying an unrecognised client error wastes attempts
  // more often than it recovers.
  throw new PermanentAdError(codeLabel, message, "unknown" as AdErrorCategory);
}

export function classifyAdNetworkError(error: unknown): never {
  const message = error instanceof Error ? error.message : "Network error contacting Meta Marketing API";
  throw new TemporaryAdError("network_error", message, "temporary_unavailable");
}

// Sanitizes a provider error for storage/display (instruction #10/#20:
// "never expose sensitive provider data in frontend errors", "never
// display access tokens"). fbtrace_id is kept (useful for support, not
// sensitive); raw request/response bodies and headers are never captured
// by this module in the first place.
export function sanitizeAdErrorForStorage(err: unknown): { code: string; category: AdErrorCategory; message: string; fbtrace_id?: string } {
  if (err instanceof TemporaryAdError || err instanceof PermanentAdError) {
    return { code: err.code, category: err.category, message: err.message };
  }
  return { code: "unexpected_error", category: "unknown", message: err instanceof Error ? err.message : "Unknown error" };
}

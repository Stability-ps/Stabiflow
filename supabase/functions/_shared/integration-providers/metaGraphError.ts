// Meta Graph API error classification for the Integrations module
// (OAuth token exchange, resource discovery, connection health).
//
// Code mapping is a best-effort classification assembled from Meta's
// published Graph API error code reference
// (developers.facebook.com/docs/graph-api/guides/error-handling). It has
// NOT been validated against a live Meta app - see instruction #28 and the
// Phase C completion report: no real Meta API call was made while building
// this phase.
import { PermanentIntegrationError, TemporaryIntegrationError, type IntegrationErrorCategory } from "./types.ts";

type GraphErrorBody = {
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
const MISSING_PERMISSION_SUBCODES = new Set([458, 459, 460, 463, 467]);
const INVALID_REQUEST_CODES = new Set([100]);

export function classifyMetaGraphError(httpStatus: number, body: GraphErrorBody): never {
  const error = body?.error || {};
  const code = typeof error.code === "number" ? error.code : null;
  const subcode = typeof error.error_subcode === "number" ? error.error_subcode : null;
  const message = error.error_user_msg || error.message || `Meta Graph API request failed (${httpStatus})`;
  const codeLabel = code !== null ? `meta_${code}${subcode !== null ? `_${subcode}` : ""}` : `http_${httpStatus}`;

  if (code !== null && EXPIRED_TOKEN_CODES.has(code)) {
    throw new PermanentIntegrationError(codeLabel, message, "expired_token");
  }
  if (subcode !== null && MISSING_PERMISSION_SUBCODES.has(subcode)) {
    throw new PermanentIntegrationError(codeLabel, message, "missing_permission");
  }
  if (code !== null && AUTHORIZATION_CODES.has(code)) {
    throw new PermanentIntegrationError(codeLabel, message, "authorization_failure");
  }
  if (httpStatus >= 500) {
    throw new TemporaryIntegrationError(codeLabel, message, "temporary_unavailable");
  }
  if (code !== null && RATE_LIMITED_CODES.has(code)) {
    throw new TemporaryIntegrationError(codeLabel, message, "rate_limited");
  }
  if (code !== null && TEMPORARY_CODES.has(code)) {
    throw new TemporaryIntegrationError(codeLabel, message, "temporary_unavailable");
  }
  if (code !== null && INVALID_REQUEST_CODES.has(code)) {
    throw new PermanentIntegrationError(codeLabel, message, "invalid_request");
  }
  if (httpStatus === 404) {
    throw new PermanentIntegrationError(codeLabel, message, "invalid_resource");
  }
  // Unknown 4xx: permanent by default - retrying an unrecognised client
  // error wastes attempts more often than it recovers.
  throw new PermanentIntegrationError(codeLabel, message, "unknown" as IntegrationErrorCategory);
}

export function classifyIntegrationNetworkError(error: unknown): never {
  const message = error instanceof Error ? error.message : "Network error contacting the provider";
  throw new TemporaryIntegrationError("network_error", message, "temporary_unavailable");
}

// Sanitizes a provider error for storage/display (instruction #10/#38:
// "never expose raw provider error payloads", "never expose secrets").
// fbtrace_id is kept (useful for support, not sensitive); raw
// request/response bodies and headers are never captured here.
export function sanitizeIntegrationError(err: unknown): { code: string; category: IntegrationErrorCategory; message: string } {
  if (err instanceof TemporaryIntegrationError || err instanceof PermanentIntegrationError) {
    return { code: err.code, category: err.category, message: err.message };
  }
  return { code: "unexpected_error", category: "unknown", message: err instanceof Error ? err.message : "Unknown error" };
}

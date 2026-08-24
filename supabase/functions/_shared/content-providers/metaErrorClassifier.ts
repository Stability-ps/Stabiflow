// Shared Meta Graph API error classification, used by both meta-facebook.ts
// and meta-instagram.ts since they return the same error envelope shape.
// Reference: Meta Graph API error codes (developers.facebook.com/docs/graph-api/guides/error-handling).
//
// Ported unchanged from Acapolite's _shared/social-providers/metaErrorClassifier.ts.
import { PermanentPublishError, TemporaryPublishError } from "./types.ts";

type MetaErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

const TEMPORARY_CODES = new Set([1, 2, 4, 17, 32, 613]); // unknown/transient, API too busy, app/user rate limits
const PERMANENT_CODES = new Set([100, 190, 200, 10, 803]); // invalid parameter, expired/invalid token, permission denied, unknown path/object

export function classifyMetaError(httpStatus: number, body: MetaErrorBody): never {
  const error = body?.error || {};
  const code = typeof error.code === "number" ? error.code : null;
  const message = error.message || `Meta API request failed (${httpStatus})`;
  const codeLabel = code !== null ? `meta_${code}` : `http_${httpStatus}`;

  if (httpStatus >= 500) {
    throw new TemporaryPublishError(`meta_http_${httpStatus}`, message);
  }
  if (code !== null && TEMPORARY_CODES.has(code)) {
    throw new TemporaryPublishError(codeLabel, message);
  }
  if (code !== null && PERMANENT_CODES.has(code)) {
    throw new PermanentPublishError(codeLabel, message);
  }
  // Unknown 4xx: treat as permanent by default - retrying an unrecognised
  // client error is more likely to waste attempts than recover, and it
  // surfaces immediately for a manual look instead of quietly retrying for
  // hours.
  throw new PermanentPublishError(codeLabel, message);
}

export function classifyNetworkError(error: unknown): never {
  const message = error instanceof Error ? error.message : "Network error contacting Meta";
  throw new TemporaryPublishError("network_error", message);
}

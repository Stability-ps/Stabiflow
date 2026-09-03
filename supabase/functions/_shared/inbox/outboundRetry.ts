// Phase 9 - WhatsApp outbound retry + dead-letter reliability. The PURE
// decision layer: turn a caught provider error into one of three classes,
// and compute the backoff schedule. No I/O. Mirrored by
// src/lib/outboundRetry.ts (delivery-state labels only) and by the
// apply_whatsapp_retry_outcome() SQL (the schedule constants must match).
//
//   retryable      - a transient technical failure (timeout, network,
//                    429, provider 5xx). Auto-retried with bounded backoff.
//   permanent      - the provider rejected the request for a reason that
//                    will not change on its own (invalid recipient/params,
//                    template rejected, unknown 4xx). Dead-lettered now.
//   policy_blocked - a credential / permission / config problem the
//                    operator must fix (expired token, auth failure,
//                    missing permission). NOT hot-looped against Meta -
//                    dead-lettered so Needs Attention surfaces it once.
//
// Uses the EXISTING classifier (metaGraphError.ts) - one authoritative
// interpretation of Meta's error codes, not a second copy here.
import { sanitizeIntegrationError } from "../integration-providers/metaGraphError.ts";
import { PermanentIntegrationError, TemporaryIntegrationError } from "../integration-providers/types.ts";

export type OutboundFailureClass = "retryable" | "permanent" | "policy_blocked";

export type OutboundFailureClassification = {
  failureClass: OutboundFailureClass;
  code: string;
  category: string;
  message: string;
};

const RETRYABLE_CATEGORIES = new Set(["temporary_unavailable", "rate_limited"]);
const POLICY_CATEGORIES = new Set(["expired_token", "authorization_failure", "missing_permission"]);

/** Classify a caught send error. Anything the existing classifier calls a
 * TemporaryIntegrationError (or a network error) is retryable; an
 * operator-actionable PermanentIntegrationError (bad/expired credential,
 * missing permission) is policy_blocked; every other permanent error
 * dead-letters immediately. An unrecognised error is treated as permanent
 * - retrying an error we cannot classify wastes attempts more often than
 * it recovers (same posture as metaGraphError.ts's "unknown 4xx"). */
export function classifyOutboundFailure(err: unknown): OutboundFailureClassification {
  const s = sanitizeIntegrationError(err);
  if (err instanceof TemporaryIntegrationError || RETRYABLE_CATEGORIES.has(s.category) || s.code === "network_error") {
    return { failureClass: "retryable", ...s };
  }
  if (err instanceof PermanentIntegrationError && POLICY_CATEGORIES.has(s.category)) {
    return { failureClass: "policy_blocked", ...s };
  }
  return { failureClass: "permanent", ...s };
}

// --- backoff schedule (MUST match apply_whatsapp_retry_outcome SQL) -------

/** Max AUTOMATIC provider attempts after the original = 3 (4 total). */
export const MAX_RETRIES = 3;

/** Seconds to wait before retry N (1-indexed). Bounded, conservative. */
export const RETRY_BACKOFF_SECONDS = [60, 300, 900] as const;

/** The initial failure schedules the first retry this many seconds out. */
export const INITIAL_RETRY_DELAY_SECONDS = 60;

/** A claimed-but-never-finished retry becomes eligible again after this. */
export const RETRY_CLAIM_TIMEOUT_MINUTES = 5;

/** Deterministic per-attempt jitter (0..29s) so a burst of failures from
 * one incident does not all retry on the same tick. Deterministic keeps
 * the schedule unit-testable. */
export function retryJitterSeconds(retryCount: number): number {
  return (retryCount * 7) % 30;
}

/** When does retry `retryCountAfterIncrement` fire? Returns null once the
 * limit is reached (caller must dead-letter instead). */
export function computeNextRetryAt(retryCountAfterIncrement: number, now: Date): Date | null {
  if (retryCountAfterIncrement >= MAX_RETRIES) return null;
  const base = RETRY_BACKOFF_SECONDS[Math.min(retryCountAfterIncrement, RETRY_BACKOFF_SECONDS.length - 1)];
  return new Date(now.getTime() + (base + retryJitterSeconds(retryCountAfterIncrement)) * 1000);
}

/** Delivery statuses that mean the provider accepted the message - never
 * auto-retried, never downgraded by a stale scheduled retry. */
export const ACCEPTED_DELIVERY_STATUSES = new Set(["submitted", "sent", "delivered", "read"]);

export function isAcceptedDelivery(status: string | null | undefined): boolean {
  return !!status && ACCEPTED_DELIVERY_STATUSES.has(status);
}

export type InitialFailurePatch = {
  delivery_status: "failed";
  last_failure_code: string;
  last_failure_category: string;
  next_retry_at: string | null;
  dead_lettered_at: string | null;
  dead_letter_reason: string | null;
};

/** The inbox_messages column patch for the FIRST failed provider attempt at
 * a send call site (inbox-actions / whatsapp-webhook). Retryable schedules
 * the first retry; permanent / policy-blocked dead-letters immediately so
 * Needs Attention surfaces it once. retry_count stays 0 - the worker owns
 * the retry counter from here. */
export function initialFailurePatch(err: unknown, now: Date = new Date()): InitialFailurePatch {
  const c = classifyOutboundFailure(err);
  if (c.failureClass === "retryable") {
    return {
      delivery_status: "failed",
      last_failure_code: c.code,
      last_failure_category: c.category,
      next_retry_at: new Date(now.getTime() + INITIAL_RETRY_DELAY_SECONDS * 1000).toISOString(),
      dead_lettered_at: null,
      dead_letter_reason: null,
    };
  }
  return {
    delivery_status: "failed",
    last_failure_code: c.code,
    last_failure_category: c.category,
    next_retry_at: null,
    dead_lettered_at: now.toISOString(),
    dead_letter_reason: c.code || c.failureClass,
  };
}

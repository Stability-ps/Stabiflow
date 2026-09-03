import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ACCEPTED_DELIVERY_STATUSES,
  classifyOutboundFailure,
  computeNextRetryAt,
  initialFailurePatch,
  INITIAL_RETRY_DELAY_SECONDS,
  isAcceptedDelivery,
  MAX_RETRIES,
  RETRY_BACKOFF_SECONDS,
  retryJitterSeconds,
} from "./outboundRetry.ts";
import { PermanentIntegrationError, TemporaryIntegrationError } from "../integration-providers/types.ts";

// --- classifyOutboundFailure --------------------------------------------

Deno.test("classifyOutboundFailure: TemporaryIntegrationError is retryable", () => {
  const c = classifyOutboundFailure(new TemporaryIntegrationError("meta_1", "try later", "temporary_unavailable"));
  assertEquals(c.failureClass, "retryable");
  assertEquals(c.code, "meta_1");
});

Deno.test("classifyOutboundFailure: rate_limited is retryable", () => {
  const c = classifyOutboundFailure(new TemporaryIntegrationError("meta_4", "slow down", "rate_limited"));
  assertEquals(c.failureClass, "retryable");
  assertEquals(c.category, "rate_limited");
});

Deno.test("classifyOutboundFailure: network_error is retryable", () => {
  const c = classifyOutboundFailure(new TemporaryIntegrationError("network_error", "socket hang up", "temporary_unavailable"));
  assertEquals(c.failureClass, "retryable");
  assertEquals(c.code, "network_error");
});

Deno.test("classifyOutboundFailure: expired token / auth / missing permission are policy_blocked", () => {
  assertEquals(classifyOutboundFailure(new PermanentIntegrationError("meta_190", "token dead", "expired_token")).failureClass, "policy_blocked");
  assertEquals(classifyOutboundFailure(new PermanentIntegrationError("meta_10", "no auth", "authorization_failure")).failureClass, "policy_blocked");
  assertEquals(classifyOutboundFailure(new PermanentIntegrationError("meta_200_463", "scope", "missing_permission")).failureClass, "policy_blocked");
});

Deno.test("classifyOutboundFailure: invalid resource / request is permanent", () => {
  assertEquals(classifyOutboundFailure(new PermanentIntegrationError("meta_100", "bad number", "invalid_request")).failureClass, "permanent");
  assertEquals(classifyOutboundFailure(new PermanentIntegrationError("http_404", "gone", "invalid_resource")).failureClass, "permanent");
});

Deno.test("classifyOutboundFailure: an unrecognised error is permanent, not retryable", () => {
  const c = classifyOutboundFailure(new Error("kaboom"));
  assertEquals(c.failureClass, "permanent");
  assertEquals(c.code, "unexpected_error");
});

// --- backoff schedule --------------------------------------------------

Deno.test("computeNextRetryAt: 60 / 300 / 900 second schedule + deterministic jitter", () => {
  const now = new Date("2026-09-01T00:00:00.000Z");
  const at1 = computeNextRetryAt(1, now)!;
  const at2 = computeNextRetryAt(2, now)!;
  assertEquals((at1.getTime() - now.getTime()) / 1000, RETRY_BACKOFF_SECONDS[1] + retryJitterSeconds(1));
  assertEquals((at2.getTime() - now.getTime()) / 1000, RETRY_BACKOFF_SECONDS[2] + retryJitterSeconds(2));
});

Deno.test("computeNextRetryAt: returns null once MAX_RETRIES is reached", () => {
  assertEquals(computeNextRetryAt(MAX_RETRIES, new Date()), null);
  assertEquals(computeNextRetryAt(MAX_RETRIES + 1, new Date()), null);
});

Deno.test("retryJitterSeconds: bounded 0..29 and deterministic", () => {
  for (let n = 0; n < 20; n++) {
    const j = retryJitterSeconds(n);
    assertEquals(j >= 0 && j < 30, true);
    assertEquals(j, retryJitterSeconds(n));
  }
});

// --- initialFailurePatch --------------------------------------------------

Deno.test("initialFailurePatch: retryable schedules the first retry, does not dead-letter", () => {
  const now = new Date("2026-09-01T00:00:00.000Z");
  const p = initialFailurePatch(new TemporaryIntegrationError("network_error", "reset", "temporary_unavailable"), now);
  assertEquals(p.delivery_status, "failed");
  assertEquals(p.dead_lettered_at, null);
  assertEquals(p.next_retry_at, new Date(now.getTime() + INITIAL_RETRY_DELAY_SECONDS * 1000).toISOString());
});

Deno.test("initialFailurePatch: permanent dead-letters immediately, no retry scheduled", () => {
  const now = new Date("2026-09-01T00:00:00.000Z");
  const p = initialFailurePatch(new PermanentIntegrationError("meta_100", "bad recipient", "invalid_request"), now);
  assertEquals(p.next_retry_at, null);
  assertEquals(p.dead_lettered_at, now.toISOString());
  assertEquals(p.dead_letter_reason, "meta_100");
});

Deno.test("initialFailurePatch: policy_blocked dead-letters immediately (no Meta hot-loop)", () => {
  const p = initialFailurePatch(new PermanentIntegrationError("meta_190", "token dead", "expired_token"));
  assertEquals(p.next_retry_at, null);
  assertEquals(typeof p.dead_lettered_at, "string");
});

// --- isAcceptedDelivery -------------------------------------------------

Deno.test("isAcceptedDelivery: accepted states vs failed/sending/null", () => {
  for (const s of ACCEPTED_DELIVERY_STATUSES) assertEquals(isAcceptedDelivery(s), true);
  assertEquals(isAcceptedDelivery("failed"), false);
  assertEquals(isAcceptedDelivery("sending"), false);
  assertEquals(isAcceptedDelivery(null), false);
  assertEquals(isAcceptedDelivery(undefined), false);
});

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideNextState, MAX_PUBLISH_ATTEMPTS } from "./contentPublishDecision.ts";

const now = new Date("2026-09-01T07:00:00.000Z");

Deno.test("a successful publish marks the post published with provider details, no retry scheduled", () => {
  const next = decideNextState({ attemptCount: 0, status: "publishing" }, { kind: "success", providerPostId: "pid-1", permalink: "https://facebook.com/1" }, now);
  assertEquals(next.status, "published");
  if (next.status === "published") {
    assertEquals(next.providerPostId, "pid-1");
    assertEquals(next.providerPermalink, "https://facebook.com/1");
    assertEquals(next.attemptCount, 1);
    assertEquals(next.nextRetryAt, null);
  }
});

Deno.test("a temporary failure (network/5xx/rate-limit) schedules a backoff retry instead of giving up", () => {
  const next = decideNextState({ attemptCount: 0, status: "publishing" }, { kind: "temporary_failure", code: "rate_limited", message: "Too many requests" }, now);
  assertEquals(next.status, "scheduled");
  if (next.status === "scheduled") {
    assertEquals(next.attemptCount, 1);
    assertEquals(next.nextRetryAt.getTime() > now.getTime(), true);
    assertEquals(next.failureCode, "rate_limited");
  }
});

Deno.test("a permanent failure (bad image, permission denied, invalid account) fails immediately without retrying", () => {
  const next = decideNextState({ attemptCount: 0, status: "publishing" }, { kind: "permanent_failure", code: "invalid_image_format", message: "Unsupported image format" }, now);
  assertEquals(next.status, "failed");
  assertEquals(next.attemptCount, 1);
});

Deno.test("temporary failures stop retrying once MAX_PUBLISH_ATTEMPTS is reached", () => {
  const next = decideNextState({ attemptCount: MAX_PUBLISH_ATTEMPTS - 1, status: "publishing" }, { kind: "temporary_failure", code: "network_error", message: "ETIMEDOUT" }, now);
  assertEquals(next.status, "failed");
  assertEquals(next.attemptCount, MAX_PUBLISH_ATTEMPTS);
});

Deno.test("backoff delay increases with successive temporary failures (does not hammer the provider)", () => {
  const first = decideNextState({ attemptCount: 0, status: "publishing" }, { kind: "temporary_failure", code: "network_error", message: "x" }, now);
  const second = decideNextState({ attemptCount: 1, status: "scheduled" }, { kind: "temporary_failure", code: "network_error", message: "x" }, now);
  if (first.status === "scheduled" && second.status === "scheduled") {
    const firstDelay = first.nextRetryAt.getTime() - now.getTime();
    const secondDelay = second.nextRetryAt.getTime() - now.getTime();
    assertEquals(secondDelay > firstDelay, true);
  }
});

Deno.test("a permanent failure is never retried even on the very first attempt (attempt_count stays authoritative, status is terminal)", () => {
  const next = decideNextState({ attemptCount: 0, status: "publishing" }, { kind: "permanent_failure", code: "permission_denied", message: "Missing pages_manage_posts" }, now);
  assertEquals(next.status, "failed");
  if (next.status === "failed") assertEquals(next.nextRetryAt, null);
});

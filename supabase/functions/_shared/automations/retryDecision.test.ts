import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideNextRunState, MAX_RUN_ATTEMPTS } from "./retryDecision.ts";

const NOW = new Date("2026-01-01T00:00:00.000Z");

Deno.test("a successful run needs no retry", () => {
  const next = decideNextRunState({ attemptCount: 0 }, { kind: "success" }, NOW);
  assertEquals(next.status, "succeeded");
  assertEquals(next.nextRetryAt, null);
});

Deno.test("a permanent failure is never retried, even on the first attempt", () => {
  const next = decideNextRunState({ attemptCount: 0 }, { kind: "permanent_failure", code: "x", message: "y" }, NOW);
  assertEquals(next.status, "failed");
  assertEquals(next.nextRetryAt, null);
});

Deno.test("a temporary failure schedules a retry with backoff, and does not immediately fail", () => {
  const next = decideNextRunState({ attemptCount: 0 }, { kind: "temporary_failure", code: "x", message: "y" }, NOW);
  assertEquals(next.status, "pending");
  assertEquals(next.attemptCount, 1);
  if (next.status === "pending") assertEquals(next.nextRetryAt.getTime() > NOW.getTime(), true);
});

Deno.test("a temporary failure gives up once MAX_RUN_ATTEMPTS is reached - a later step failure never re-executes already-completed steps (that is automation_run_steps' job, not retried here)", () => {
  const next = decideNextRunState({ attemptCount: MAX_RUN_ATTEMPTS - 1 }, { kind: "temporary_failure", code: "x", message: "y" }, NOW);
  assertEquals(next.status, "failed");
  assertEquals(next.nextRetryAt, null);
  assertEquals(next.attemptCount, MAX_RUN_ATTEMPTS);
});

Deno.test("a partial outcome (some steps succeeded, a later one failed) is not auto-retried - needs manual retry", () => {
  const next = decideNextRunState({ attemptCount: 0 }, { kind: "partial" }, NOW);
  assertEquals(next.status, "partial");
  assertEquals(next.nextRetryAt, null);
});

Deno.test("backoff increases (or holds, capped) across consecutive temporary failures rather than retrying instantly every time", () => {
  const first = decideNextRunState({ attemptCount: 0 }, { kind: "temporary_failure", code: "x", message: "y" }, NOW);
  const second = decideNextRunState({ attemptCount: 1 }, { kind: "temporary_failure", code: "x", message: "y" }, NOW);
  if (first.status === "pending" && second.status === "pending") {
    assertEquals(second.nextRetryAt.getTime() >= first.nextRetryAt.getTime(), true);
  }
});

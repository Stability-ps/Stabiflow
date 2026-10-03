import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkPlatformCeiling, checkWorkspaceQuota, estimateCost } from "./usage.ts";

Deno.test("estimateCost computes a real number for a known model", () => {
  const cost = estimateCost("gpt-4o-mini", 1_000_000, 1_000_000);
  assertEquals(cost, 0.75); // $0.15 input + $0.60 output per 1M tokens
});

Deno.test("estimateCost returns null for an unrecognized model rather than guessing", () => {
  assertEquals(estimateCost("some-future-model-not-in-the-table", 1000, 1000), null);
});

Deno.test("checkWorkspaceQuota allows usage below the limit", () => {
  assertEquals(checkWorkspaceQuota(100, 500_000).allowed, true);
});

Deno.test("checkWorkspaceQuota blocks once usage reaches the limit", () => {
  const result = checkWorkspaceQuota(500_000, 500_000);
  assertEquals(result.allowed, false);
});

Deno.test("checkPlatformCeiling allows usage below the ceiling", () => {
  assertEquals(checkPlatformCeiling(100, 2_000_000).allowed, true);
});

Deno.test("checkPlatformCeiling blocks once the ceiling is reached, with a tenant-safe generic message", () => {
  const result = checkPlatformCeiling(2_000_000, 2_000_000);
  assertEquals(result.allowed, false);
  if (!result.allowed) {
    // Must never leak the actual usage/ceiling numbers to a tenant.
    assertEquals(result.reason.includes("2000000") || result.reason.includes("2,000,000"), false);
    assertEquals(result.reason.length > 0, true);
  }
});

Deno.test("checkPlatformCeiling's denial message is identical regardless of how far over the ceiling usage is", () => {
  const justOver = checkPlatformCeiling(2_000_001, 2_000_000);
  const wayOver = checkPlatformCeiling(9_000_000, 2_000_000);
  assertEquals(justOver.allowed, false);
  assertEquals(wayOver.allowed, false);
  if (!justOver.allowed && !wayOver.allowed) assertEquals(justOver.reason, wayOver.reason);
});

// Post-launch fix. INTEGRATIONS_META_MOCK_MODE alone cannot distinguish
// "the automated integration test suite is calling this" from "a real
// production user clicked Connect Meta at app.stabiflow.com" - there is
// only ONE deployed Supabase project (no staging), so both callers hit
// the exact same function with the exact same env flag. Confirmed the
// hard way: on 2026-08-28 a real user (the workspace owner) completed
// the real Connect Meta / Connect WhatsApp flow on production and
// received fabricated mock Pages/Instagram/Ad Accounts/a fake WhatsApp
// number, because the mock-mode flag was left on for the test suite's
// benefit with no per-request boundary.
//
// The fix: mock behavior now requires BOTH the env flag AND a per-request
// secret header only the automated test suite holds
// (INTEGRATIONS_TEST_HARNESS_SECRET, read from .env.test.local -
// gitignored, never committed, distinct from every other credential).
// An ordinary browser request never carries this header, so it can never
// receive mock data even while the env flag stays "true" for tests.
export function isTestHarnessRequest(req: Request): boolean {
  const expected = Deno.env.get("INTEGRATIONS_TEST_HARNESS_SECRET");
  if (!expected) return false;
  const provided = req.headers.get("x-stabiflow-test-harness");
  return !!provided && provided === expected;
}

// The single authoritative mock-mode resolver every OAuth/discovery entry
// point must use - never re-derive `Deno.env.get("INTEGRATIONS_META_MOCK_MODE")`
// directly, or this boundary can be silently bypassed by a new call site.
export function resolveMockMode(req: Request): boolean {
  const flagOn = (Deno.env.get("INTEGRATIONS_META_MOCK_MODE") || "").trim().toLowerCase() === "true";
  return flagOn && isTestHarnessRequest(req);
}

// True exactly when a real (non-harness) caller would have received mock
// data under the old, unsafe behavior - the case that must now be blocked
// with an explicit message instead of silently fabricating resources.
export function isBlockedMockRequest(req: Request): boolean {
  const flagOn = (Deno.env.get("INTEGRATIONS_META_MOCK_MODE") || "").trim().toLowerCase() === "true";
  return flagOn && !isTestHarnessRequest(req);
}

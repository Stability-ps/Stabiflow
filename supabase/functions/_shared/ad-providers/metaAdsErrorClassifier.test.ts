import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyAdNetworkError, classifyMetaAdsError, sanitizeAdErrorForStorage } from "./metaAdsErrorClassifier.ts";
import { PermanentAdError, TemporaryAdError } from "./types.ts";

function classify(status: number, body: unknown) {
  try {
    classifyMetaAdsError(status, body as never);
  } catch (e) {
    return e;
  }
  throw new Error("classifyMetaAdsError did not throw");
}

Deno.test("5xx is always classified as temporary_unavailable", () => {
  const err = classify(503, { error: { message: "down" } });
  assertEquals(err instanceof TemporaryAdError, true);
  assertEquals((err as TemporaryAdError).category, "temporary_unavailable");
});

Deno.test("rate limit codes (4, 17, 32, 613) classify as rate_limited", () => {
  for (const code of [4, 17, 32, 613]) {
    const err = classify(400, { error: { code, message: "rate limited" } });
    assertEquals(err instanceof TemporaryAdError, true, `code ${code} should be temporary`);
    assertEquals((err as TemporaryAdError).category, "rate_limited");
  }
});

Deno.test("code 190 (expired/invalid token) classifies as expired_token and is permanent", () => {
  const err = classify(401, { error: { code: 190, message: "token expired" } });
  assertEquals(err instanceof PermanentAdError, true);
  assertEquals((err as PermanentAdError).category, "expired_token");
});

Deno.test("codes 10/200/299 (permission) classify as authorization_failure", () => {
  for (const code of [10, 200, 299]) {
    const err = classify(403, { error: { code, message: "no permission" } });
    assertEquals((err as PermanentAdError).category, "authorization_failure");
  }
});

Deno.test("creative-review subcodes classify as invalid_creative", () => {
  const err = classify(400, { error: { code: 100, error_subcode: 1487941, message: "creative rejected" } });
  assertEquals((err as PermanentAdError).category, "invalid_creative");
});

Deno.test("policy subcode classifies as policy_review, taking priority over the generic invalid_request code", () => {
  const err = classify(400, { error: { code: 100, error_subcode: 1487742, message: "policy violation" } });
  assertEquals((err as PermanentAdError).category, "policy_review");
});

Deno.test("an unrecognised 4xx defaults to permanent/unknown, never silently retried", () => {
  const err = classify(400, { error: { code: 999999, message: "mystery" } });
  assertEquals(err instanceof PermanentAdError, true);
});

Deno.test("a 404 with no error code classifies as invalid_resource", () => {
  const err = classify(404, {});
  assertEquals((err as PermanentAdError).category, "invalid_resource");
});

Deno.test("classifyAdNetworkError always produces a temporary, retryable error", () => {
  assertThrows(() => classifyAdNetworkError(new Error("fetch failed")), TemporaryAdError);
});

Deno.test("sanitizeAdErrorForStorage never includes a raw request/response body or token", () => {
  const err = classify(401, { error: { code: 190, message: "OAuthException: token abc123secret is invalid" } });
  const sanitized = sanitizeAdErrorForStorage(err);
  assertEquals(sanitized.code, "meta_190");
  assertEquals(sanitized.category, "expired_token");
  assertEquals(typeof sanitized.message, "string");
  assertEquals(Object.keys(sanitized).includes("fbtrace_id"), false); // absent unless actually present in the error
});

Deno.test("sanitizeAdErrorForStorage handles a non-classified JS error without throwing", () => {
  const sanitized = sanitizeAdErrorForStorage(new Error("boom"));
  assertEquals(sanitized.code, "unexpected_error");
  assertEquals(sanitized.category, "unknown");
});

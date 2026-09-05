import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildInputText, clampVariantCount, parseVariantsResponse } from "./generateCopy.ts";

Deno.test("clampVariantCount: a normal value passes through unchanged", () => {
  assertEquals(clampVariantCount(3), 3);
});
Deno.test("clampVariantCount: clamps below the minimum up to 1", () => {
  assertEquals(clampVariantCount(0), 1);
  assertEquals(clampVariantCount(-5), 1);
});
Deno.test("clampVariantCount: clamps above the maximum down to 5", () => {
  assertEquals(clampVariantCount(50), 5);
});
Deno.test("clampVariantCount: non-finite input falls back to the minimum, never NaN/Infinity", () => {
  assertEquals(clampVariantCount(NaN), 1);
  assertEquals(clampVariantCount(Infinity), 1);
});
Deno.test("clampVariantCount: rounds a fractional value", () => {
  assertEquals(clampVariantCount(2.6), 3);
});

Deno.test("buildInputText: includes the business context and clamped variant count", () => {
  const text = buildInputText({ businessContext: "A coffee shop", variantCount: 3 });
  assertEquals(text.includes("A coffee shop"), true);
  assertEquals(text.includes("exactly 3"), true);
});
Deno.test("buildInputText: omits audience/tone lines when not provided", () => {
  const text = buildInputText({ businessContext: "A coffee shop", variantCount: 2 });
  assertEquals(text.includes("Target audience"), false);
  assertEquals(text.includes("Tone:"), false);
});
Deno.test("buildInputText: includes audience/tone when provided", () => {
  const text = buildInputText({ businessContext: "A coffee shop", audience: "students", tone: "playful", variantCount: 2 });
  assertEquals(text.includes("Target audience: students"), true);
  assertEquals(text.includes("Tone: playful"), true);
});

Deno.test("parseVariantsResponse: accepts a well-formed response", () => {
  const result = parseVariantsResponse({ variants: [{ headline: "H", primaryText: "P", description: "D", cta: "Shop Now" }] });
  assertEquals(result.length, 1);
  assertEquals(result[0].cta, "Shop Now");
});
Deno.test("parseVariantsResponse: rejects a response missing the variants array", () => {
  assertThrows(() => parseVariantsResponse({}), Error, "Unexpected response shape");
});
Deno.test("parseVariantsResponse: rejects a response where variants is not an array", () => {
  assertThrows(() => parseVariantsResponse({ variants: "not-an-array" }), Error, "Unexpected response shape");
});
Deno.test("parseVariantsResponse: rejects a variant missing a required field", () => {
  assertThrows(() => parseVariantsResponse({ variants: [{ headline: "H", primaryText: "P", description: "D" }] }), Error, "missing a required text field");
});
Deno.test("parseVariantsResponse: rejects a variant that is not an object", () => {
  assertThrows(() => parseVariantsResponse({ variants: ["not-an-object"] }), Error, "is not an object");
});
Deno.test("parseVariantsResponse: an empty variants array is valid (zero results, not an error)", () => {
  assertEquals(parseVariantsResponse({ variants: [] }), []);
});

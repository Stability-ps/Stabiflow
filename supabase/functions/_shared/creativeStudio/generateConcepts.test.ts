import { assertEquals, assertStringIncludes, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { appendNoTextRule, buildInputText, clampConceptCount, NO_TEXT_RULE, parseConceptsResponse } from "./generateConcepts.ts";

Deno.test("clampConceptCount: normal value passes through", () => {
  assertEquals(clampConceptCount(4), 4);
});
Deno.test("clampConceptCount: clamps below 1 up to 1", () => {
  assertEquals(clampConceptCount(0), 1);
  assertEquals(clampConceptCount(-3), 1);
});
Deno.test("clampConceptCount: clamps above the V1 cap (6) down to 6", () => {
  assertEquals(clampConceptCount(7), 6);
  assertEquals(clampConceptCount(50), 6);
});
Deno.test("clampConceptCount: non-finite falls back to 1", () => {
  assertEquals(clampConceptCount(NaN), 1);
  assertEquals(clampConceptCount(Infinity), 1);
});

Deno.test("appendNoTextRule: always appends the no-text/no-logo rule", () => {
  const out = appendNoTextRule("A calm office at sunrise");
  assertStringIncludes(out, "no text");
  assertStringIncludes(out, "no logos");
  assertStringIncludes(out, "no watermarks");
});
Deno.test("appendNoTextRule: idempotent when the model already echoed the rule", () => {
  const once = appendNoTextRule("A desk. no text, no logos, no watermarks");
  // Rule fragment present exactly once (not doubled).
  assertEquals(once.split("no watermarks").length - 1, 1);
});
Deno.test("appendNoTextRule: empty prompt still yields the rule", () => {
  assertEquals(appendNoTextRule("   "), NO_TEXT_RULE);
});

Deno.test("buildInputText: includes context and clamped concept count", () => {
  const t = buildInputText({ businessContext: "A bakery", conceptCount: 4 });
  assertStringIncludes(t, "A bakery");
  assertStringIncludes(t, "exactly 4");
});
Deno.test("buildInputText: includes copy seeds when provided", () => {
  const t = buildInputText({
    businessContext: "A bakery",
    conceptCount: 2,
    copySeeds: [{ headline: "Fresh daily", primaryText: "Warm bread", description: "d", cta: "Order now" }],
  });
  assertStringIncludes(t, "Fresh daily");
  assertStringIncludes(t, "Order now");
});

Deno.test("parseConceptsResponse: accepts a well-formed response and force-appends the no-text rule to every prompt", () => {
  const parsed = parseConceptsResponse({
    concepts: [
      {
        conceptName: "Hopeful founder",
        headline: "Take back your time",
        supportingText: "Automate the busywork",
        cta: "Start free",
        visualPrompt: "A founder smiling at a laptop in a bright office, copy space on the left",
        layoutStyle: "split",
        visualNotes: "warm palette, subject right",
      },
    ],
  });
  assertEquals(parsed.length, 1);
  assertStringIncludes(parsed[0].visualPrompt, "no text");
  assertStringIncludes(parsed[0].visualPrompt, "no logos");
});
Deno.test("parseConceptsResponse: unknown layoutStyle is normalised to 'split'", () => {
  const parsed = parseConceptsResponse({
    concepts: [{ conceptName: "c", headline: "h", supportingText: "s", cta: "go", visualPrompt: "p", layoutStyle: "collage", visualNotes: "n" }],
  });
  assertEquals(parsed[0].layoutStyle, "split");
});
Deno.test("parseConceptsResponse: rejects a response missing the concepts array (malformed AI response fails safely)", () => {
  assertThrows(() => parseConceptsResponse({}), Error, "Unexpected response shape");
  assertThrows(() => parseConceptsResponse({ concepts: "nope" }), Error, "Unexpected response shape");
});
Deno.test("parseConceptsResponse: rejects a concept missing a required field", () => {
  assertThrows(
    () => parseConceptsResponse({ concepts: [{ conceptName: "c", headline: "h", supportingText: "s", cta: "go", visualPrompt: "p", layoutStyle: "split" }] }),
    Error,
    "missing a required text field",
  );
});
Deno.test("parseConceptsResponse: rejects a concept with an empty required field", () => {
  assertThrows(
    () => parseConceptsResponse({ concepts: [{ conceptName: "  ", headline: "h", supportingText: "s", cta: "go", visualPrompt: "p", layoutStyle: "split", visualNotes: "n" }] }),
    Error,
    "empty required field",
  );
});

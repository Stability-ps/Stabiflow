import { assertEquals, assertStringIncludes, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { appendNoTextRule, applyCopyOverrides, buildInputText, buildInstructions, clampConceptCount, NO_TEXT_RULE, parseConceptsResponse, type VisualConcept } from "./generateConcepts.ts";

function fixtureConcepts(): VisualConcept[] {
  return [
    { conceptName: "A", headline: "AI headline A", supportingText: "AI body A", cta: "AI CTA A", visualPrompt: "p. no text, no logos.", layoutStyle: "split", visualNotes: "n" },
    { conceptName: "B", headline: "AI headline B", supportingText: "AI body B", cta: "AI CTA B", visualPrompt: "p. no text, no logos.", layoutStyle: "split", visualNotes: "n" },
  ];
}

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

// -- referenceGuidance integration (reference-ads plan) ---------------------
Deno.test("buildInputText: includes referenceGuidance when provided, after the brief", () => {
  const t = buildInputText({
    businessContext: "A bakery",
    conceptCount: 2,
    referenceGuidance: "A reference advert was provided as style inspiration: keep similar colours.",
  });
  assertStringIncludes(t, "A bakery");
  assertStringIncludes(t, "keep similar colours");
  // Guidance appears after the business brief, never before it - the
  // brief stays the primary/first source of fact.
  assertEquals(t.indexOf("A bakery") < t.indexOf("keep similar colours"), true);
});
Deno.test("buildInputText: omits any reference section when no guidance is given (unchanged legacy behaviour)", () => {
  const t = buildInputText({ businessContext: "A bakery", conceptCount: 2 });
  assertEquals(t.toLowerCase().includes("reference"), false);
});
Deno.test("buildInputText: includes visualDirection as background-only style/scene guidance", () => {
  const t = buildInputText({
    businessContext: "A bakery",
    conceptCount: 2,
    visualDirection: "A warm sunrise over a rustic counter",
  });
  assertStringIncludes(t, "A warm sunrise over a rustic counter");
  assertStringIncludes(t, "Visual direction");
});
Deno.test("buildInputText: omits visual direction section when not provided", () => {
  const t = buildInputText({ businessContext: "A bakery", conceptCount: 2 });
  assertEquals(t.includes("Visual direction"), false);
});
Deno.test("buildInputText: reference guidance and visual direction coexist without one overwriting the other", () => {
  const t = buildInputText({
    businessContext: "A bakery",
    conceptCount: 2,
    referenceGuidance: "keep similar colours",
    visualDirection: "a warm sunrise scene",
  });
  assertStringIncludes(t, "keep similar colours");
  assertStringIncludes(t, "a warm sunrise scene");
});
Deno.test("applyCopyOverrides: a supplied headline is applied verbatim to every concept, unchanged (instruction #9/#10)", () => {
  const out = applyCopyOverrides(fixtureConcepts(), { headline: "User headline" });
  assertEquals(out[0].headline, "User headline");
  assertEquals(out[1].headline, "User headline");
  // Only headline was overridden - body/cta stay AI-generated.
  assertEquals(out[0].supportingText, "AI body A");
  assertEquals(out[0].cta, "AI CTA A");
});
Deno.test("applyCopyOverrides: a blank/undefined override leaves the AI's own per-concept text untouched (instruction #11)", () => {
  const out = applyCopyOverrides(fixtureConcepts(), { headline: "   ", body: undefined });
  assertEquals(out[0].headline, "AI headline A");
  assertEquals(out[1].headline, "AI headline B");
});
Deno.test("applyCopyOverrides: no overrides object at all is a pure no-op (returns the same concepts)", () => {
  const concepts = fixtureConcepts();
  const out = applyCopyOverrides(concepts, undefined);
  assertEquals(out, concepts);
});
Deno.test("applyCopyOverrides: a custom campaign CTA overrides every concept's AI CTA (instruction #8)", () => {
  const out = applyCopyOverrides(fixtureConcepts(), { cta: "Book a free quote" });
  assertEquals(out[0].cta, "Book a free quote");
  assertEquals(out[1].cta, "Book a free quote");
});
Deno.test("applyCopyOverrides: headline/body/cta overrides are independent - only the supplied fields change", () => {
  const out = applyCopyOverrides(fixtureConcepts(), { body: "User body only" });
  assertEquals(out[0].headline, "AI headline A");
  assertEquals(out[0].supportingText, "User body only");
  assertEquals(out[0].cta, "AI CTA A");
});

Deno.test("buildInstructions: warns the model that reference guidance is style-only, never a source of commercial fact", () => {
  const instructions = buildInstructions();
  assertStringIncludes(instructions.toLowerCase(), "reference-advert style guidance");
  assertStringIncludes(instructions, "sole source of commercial fact");
});

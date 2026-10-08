import { assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  analyzeReferenceStyle,
  buildReferenceGuidanceText,
  estimateAiCallCount,
  isReferenceImageEligible,
  parseAnalysisResponse,
  REFERENCE_IMAGE_MAX_BYTES,
  sanitizeStyleText,
  shouldAnalyzeReference,
  type ReferenceStyle,
} from "./analyzeReference.ts";

// -- isReferenceImageEligible ------------------------------------------------

Deno.test("isReferenceImageEligible: jpeg/png under the cap are eligible", () => {
  assertEquals(isReferenceImageEligible("image/jpeg", 1024).eligible, true);
  assertEquals(isReferenceImageEligible("image/png", REFERENCE_IMAGE_MAX_BYTES).eligible, true);
});
Deno.test("isReferenceImageEligible: unsupported mime is rejected with a reason", () => {
  const r = isReferenceImageEligible("image/webp", 1024);
  assertEquals(r.eligible, false);
  if (!r.eligible) assertEquals(r.reason.includes("Unsupported"), true);
});
Deno.test("isReferenceImageEligible: over the size cap is rejected", () => {
  const r = isReferenceImageEligible("image/png", REFERENCE_IMAGE_MAX_BYTES + 1);
  assertEquals(r.eligible, false);
});
Deno.test("isReferenceImageEligible: zero/NaN size is rejected, never silently allowed", () => {
  assertEquals(isReferenceImageEligible("image/png", 0).eligible, false);
  assertEquals(isReferenceImageEligible("image/png", NaN).eligible, false);
});

// -- shouldAnalyzeReference (the AI-call-economy choke point) --------------

Deno.test("shouldAnalyzeReference: false when purpose is not reference_creative", () => {
  assertEquals(
    shouldAnalyzeReference({ purpose: "product_image", sourceMediaAssetId: "a1", existingReferenceStyle: null, existingReferenceSourceAssetId: null }),
    false,
  );
  assertEquals(
    shouldAnalyzeReference({ purpose: null, sourceMediaAssetId: "a1", existingReferenceStyle: null, existingReferenceSourceAssetId: null }),
    false,
  );
});
Deno.test("shouldAnalyzeReference: false when no asset is attached", () => {
  assertEquals(
    shouldAnalyzeReference({ purpose: "reference_creative", sourceMediaAssetId: null, existingReferenceStyle: null, existingReferenceSourceAssetId: null }),
    false,
  );
});
Deno.test("shouldAnalyzeReference: true the first time (no cached style yet)", () => {
  assertEquals(
    shouldAnalyzeReference({ purpose: "reference_creative", sourceMediaAssetId: "a1", existingReferenceStyle: null, existingReferenceSourceAssetId: null }),
    true,
  );
});
Deno.test("shouldAnalyzeReference: false when already analyzed for this exact asset - never re-spend a vision call", () => {
  assertEquals(
    shouldAnalyzeReference({
      purpose: "reference_creative",
      sourceMediaAssetId: "a1",
      existingReferenceStyle: { mood: "calm" },
      existingReferenceSourceAssetId: "a1",
    }),
    false,
  );
});
Deno.test("shouldAnalyzeReference: true when the asset changed even though a (stale) style is cached", () => {
  assertEquals(
    shouldAnalyzeReference({
      purpose: "reference_creative",
      sourceMediaAssetId: "a2",
      existingReferenceStyle: { mood: "calm" },
      existingReferenceSourceAssetId: "a1",
    }),
    true,
  );
});

// -- estimateAiCallCount (the documented 8-call scenario) -------------------

Deno.test("estimateAiCallCount: 1 reference + 6 concepts = 8 total AI calls", () => {
  assertEquals(estimateAiCallCount({ hasReference: true, conceptCount: 6 }), 8);
});
Deno.test("estimateAiCallCount: no reference = concept generation + one call per concept only", () => {
  assertEquals(estimateAiCallCount({ hasReference: false, conceptCount: 4 }), 5);
});
Deno.test("estimateAiCallCount: rendering 1:1/4:5/9:16 variants adds zero AI calls (not part of this count)", () => {
  // Same call count regardless of how many sizes/layouts are later rendered
  // from those 6 concepts - the estimate only ever reflects concepts, not
  // the deterministic render fan-out.
  assertEquals(estimateAiCallCount({ hasReference: true, conceptCount: 6 }), 8);
});

// -- sanitizeStyleText: defense in depth against smuggled commercial facts --

Deno.test("sanitizeStyleText: redacts phone numbers", () => {
  assertEquals(sanitizeStyleText("Call +27 82 555 1234 now"), "Call [redacted] now");
});
Deno.test("sanitizeStyleText: redacts emails", () => {
  assertEquals(sanitizeStyleText("contact hello@acme.co.za"), "contact [redacted]");
});
Deno.test("sanitizeStyleText: redacts URLs", () => {
  assertEquals(sanitizeStyleText("visit https://acme.co.za today"), "visit [redacted] today");
});
Deno.test("sanitizeStyleText: redacts prices", () => {
  assertEquals(sanitizeStyleText("only R199 this week"), "only [redacted] this week");
});
Deno.test("sanitizeStyleText: truncates to maxLen", () => {
  assertEquals(sanitizeStyleText("a".repeat(300), 10).length, 10);
});
Deno.test("sanitizeStyleText: plain style text passes through untouched", () => {
  assertEquals(sanitizeStyleText("warm, sunlit, minimal"), "warm, sunlit, minimal");
});

// -- parseAnalysisResponse ---------------------------------------------------

const VALID_RAW = {
  dominant_colors: ["#1f2937", "#f59e0b"],
  layout_style: "split",
  subject_position: "right third",
  text_regions: ["top-left", "bottom-center"],
  visual_style: "clean product photography",
  background_style: "soft gradient",
  whitespace_level: "generous",
  mood: "professional, calm",
};

Deno.test("parseAnalysisResponse: accepts a well-formed response", () => {
  const style = parseAnalysisResponse(VALID_RAW);
  assertEquals(style.layout_style, "split");
  assertEquals(style.dominant_colors, ["#1f2937", "#f59e0b"]);
  assertEquals(style.text_regions, ["top-left", "bottom-center"]);
});
Deno.test("parseAnalysisResponse: throws on missing required field", () => {
  const { mood: _mood, ...rest } = VALID_RAW;
  assertThrows(() => parseAnalysisResponse(rest));
});
Deno.test("parseAnalysisResponse: throws on non-object input", () => {
  assertThrows(() => parseAnalysisResponse(null));
  assertThrows(() => parseAnalysisResponse("a string"));
});
Deno.test("parseAnalysisResponse: caps dominant_colors to 6 and text_regions to 8", () => {
  const style = parseAnalysisResponse({
    ...VALID_RAW,
    dominant_colors: Array.from({ length: 20 }, (_, i) => `#${i}`),
    text_regions: Array.from({ length: 20 }, (_, i) => `region-${i}`),
  });
  assertEquals(style.dominant_colors.length, 6);
  assertEquals(style.text_regions.length, 8);
});
Deno.test("parseAnalysisResponse: sanitizes a model that ignored instructions and leaked a phone number", () => {
  const style = parseAnalysisResponse({ ...VALID_RAW, mood: "call +27 82 555 1234 for a quote" });
  assertEquals(style.mood.includes("082"), false);
  assertEquals(style.mood.includes("[redacted]"), true);
});
Deno.test("parseAnalysisResponse: drops non-string array items instead of throwing", () => {
  const style = parseAnalysisResponse({ ...VALID_RAW, dominant_colors: ["#fff", 42, null, "#000"] });
  assertEquals(style.dominant_colors, ["#fff", "#000"]);
});

// -- buildReferenceGuidanceText ---------------------------------------------

const STYLE: ReferenceStyle = {
  dominant_colors: ["#1f2937", "#f59e0b"],
  layout_style: "split",
  subject_position: "right third",
  text_regions: ["top-left"],
  visual_style: "clean product photography",
  background_style: "soft gradient",
  whitespace_level: "generous",
  mood: "professional, calm",
};

Deno.test("buildReferenceGuidanceText: fresh_layout alone ignores the reference's layout/imagery", () => {
  const text = buildReferenceGuidanceText(STYLE, { keep_colours: false, keep_layout: false, keep_imagery: false, fresh_layout: true });
  assertEquals(text.includes("ignore this reference's layout and imagery"), true);
});
Deno.test("buildReferenceGuidanceText: keep_colours mentions the dominant palette", () => {
  const text = buildReferenceGuidanceText(STYLE, { keep_colours: true, keep_layout: false, keep_imagery: false, fresh_layout: false });
  assertEquals(text.includes("#1f2937"), true);
});
Deno.test("buildReferenceGuidanceText: keep_layout mentions composition, not exact artwork", () => {
  const text = buildReferenceGuidanceText(STYLE, { keep_colours: false, keep_layout: true, keep_imagery: false, fresh_layout: false });
  assertEquals(text.includes("do not copy its exact artwork"), true);
});
Deno.test("buildReferenceGuidanceText: no toggles selected still frames it as inspiration-only, never a copy source", () => {
  const text = buildReferenceGuidanceText(STYLE, { keep_colours: false, keep_layout: false, keep_imagery: false, fresh_layout: false });
  assertEquals(text.toLowerCase().includes("inspiration"), true);
  assertEquals(text.includes("do not reuse its exact layout"), true);
});
Deno.test("buildReferenceGuidanceText: never contains a phone/email/URL/price pattern - style object structurally cannot hold one", () => {
  const text = buildReferenceGuidanceText(STYLE, { keep_colours: true, keep_layout: true, keep_imagery: true, fresh_layout: false });
  // The guidance is built purely from STYLE's own (already-sanitized)
  // fields, so running it back through sanitizeStyleText must be a no-op.
  assertEquals(sanitizeStyleText(text, text.length), text);
});

// -- analyzeReferenceStyle: mocked fetch only, never a real OpenAI call -----

function fakeResponsesApi(outputText: string, ok = true, status = 200): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify({ output_text: outputText }), { status, headers: { "content-type": "application/json" } }),
    )) as unknown as typeof fetch;
}

Deno.test("analyzeReferenceStyle: parses a well-formed mocked response", async () => {
  const style = await analyzeReferenceStyle({ apiKey: "test", model: "test-model" }, "data:image/png;base64,AAAA", fakeResponsesApi(JSON.stringify(VALID_RAW)));
  assertEquals(style.layout_style, "split");
});
Deno.test("analyzeReferenceStyle: throws (never silently returns fake data) on a non-ok response", async () => {
  await assertRejects(() => analyzeReferenceStyle({ apiKey: "test", model: "test-model" }, "data:image/png;base64,AAAA", fakeResponsesApi("", false, 500)));
});

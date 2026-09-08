// Creative Studio: reference-advert style analysis.
//
// ONE vision call, run against a workspace-owned content_media_assets
// image, that produces STYLE guidance only - never commercial fact. The
// output feeds generateConcepts.buildInputText as guidance text; it is
// never treated as authoritative campaign copy (see creative-studio-
// concepts/index.ts and Task 10 of the reference-ads plan: "reference
// advert != content source").
//
// Mirrors the existing _shared/inbox/multimodalMedia.ts pattern: bounded
// MIME allowlist, bounded size, workspace-path validation happens in the
// caller (the asset row is already loaded + workspace-checked there), and
// bytes are inlined as a base64 data URL - never a public URL, never a
// provider file upload.

export type ReferenceStyle = {
  dominant_colors: string[];
  layout_style: string;
  subject_position: string;
  text_regions: string[];
  visual_style: string;
  background_style: string;
  whitespace_level: string;
  mood: string;
};

export type ReferencePreferences = {
  keep_colours: boolean;
  keep_layout: boolean;
  keep_imagery: boolean;
  fresh_layout: boolean;
};

// content_media_assets only ever stores what its own upload path accepts
// (src/lib/contentMediaAssets.ts ALLOWED_MIME_TYPES) - reference analysis
// narrows to the same two formats, and caps well below the 15MB storage
// cap so a large-but-valid asset is never forwarded to the provider
// (same "deliberately below the storage cap" posture as AI_MEDIA_MAX_BYTES
// in multimodalMedia.ts).
export const REFERENCE_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);
export const REFERENCE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export type ReferenceEligibility = { eligible: true } | { eligible: false; reason: string };

export function isReferenceImageEligible(mime: string, sizeBytes: number): ReferenceEligibility {
  if (!REFERENCE_IMAGE_MIME_TYPES.has((mime || "").toLowerCase().trim())) {
    return { eligible: false, reason: `Unsupported image type for reference analysis: ${mime || "unknown"}` };
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { eligible: false, reason: "Reference image has an unknown size" };
  }
  if (sizeBytes > REFERENCE_IMAGE_MAX_BYTES) {
    return { eligible: false, reason: `Reference image is too large (max ${REFERENCE_IMAGE_MAX_BYTES / (1024 * 1024)}MB)` };
  }
  return { eligible: true };
}

// -- cache decision (the AI-call-economy choke point) -----------------------
// A batch's reference_style is analyzed AT MOST once, regardless of how
// many concepts or retries happen inside that batch (Task 7/13: one
// reference shared across the whole batch). This is the single place that
// decides "do we spend a vision call", kept pure and exported so the
// economy invariant is a unit test, not a manual read of the endpoint.
// Documents + guards the AI-call economy for one "Generate visual
// concepts" -> "Generate backgrounds" run: at most one reference-analysis
// call (regardless of concept count - it is shared across the whole
// batch), one concept-generation call, and exactly one image-generation
// call per concept. Rendering the final 1:1/4:5/9:16 x N-layout creatives
// costs zero further AI calls (deterministic crop/composite). For the
// documented example (1 reference, 6 concepts) this is 1 + 1 + 6 = 8.
export function estimateAiCallCount(input: { hasReference: boolean; conceptCount: number }): number {
  const concepts = Math.max(0, Math.round(input.conceptCount));
  return (input.hasReference ? 1 : 0) + 1 + concepts;
}

export function shouldAnalyzeReference(input: {
  purpose: "reference_creative" | "product_image" | "background" | null | undefined;
  sourceMediaAssetId: string | null;
  existingReferenceStyle: unknown;
  existingReferenceSourceAssetId: string | null;
}): boolean {
  if (input.purpose !== "reference_creative") return false;
  if (!input.sourceMediaAssetId) return false;
  // Already analyzed for this exact asset on this batch - reuse the cache.
  if (input.existingReferenceStyle && input.existingReferenceSourceAssetId === input.sourceMediaAssetId) {
    return false;
  }
  return true;
}

export function buildAnalysisInstructions(): string {
  return [
    "You are a visual design analyst describing the STYLE of an existing advert image for a teammate who will brief a completely new advert inspired by it.",
    "Describe visual style attributes ONLY: dominant colours (as hex or plain colour names), the layout/composition style, where the main subject sits, where blocks of text are POSITIONED (e.g. 'top-left', 'lower third, centered') - never what any text says, the overall visual/photographic style, the background treatment, how much empty/whitespace the design has, and its mood.",
    "CRITICAL: never transcribe, quote, translate, or guess any words, numbers, prices, phone numbers, URLs, dates, or names visible in the image. If you cannot describe a style attribute without reading text, describe its position or appearance only.",
    "This is style guidance for a NEW advert, not a copy of this one - never suggest reusing this image's exact artwork.",
  ].join(" ");
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    dominant_colors: { type: "array", items: { type: "string" } },
    layout_style: { type: "string" },
    subject_position: { type: "string" },
    text_regions: { type: "array", items: { type: "string" } },
    visual_style: { type: "string" },
    background_style: { type: "string" },
    whitespace_level: { type: "string" },
    mood: { type: "string" },
  },
  required: [
    "dominant_colors",
    "layout_style",
    "subject_position",
    "text_regions",
    "visual_style",
    "background_style",
    "whitespace_level",
    "mood",
  ],
  additionalProperties: false,
} as const;

// Defense in depth: even though the prompt and schema already exclude any
// "transcribed text" field, sanitize every returned string so a model that
// ignores instructions still cannot smuggle a phone number, email, URL, or
// price through a style field (Task 5/10: no OCR'd commercial fact ever
// reaches reference_style).
const PHONE_LIKE = /(\+?\d[\d\s().-]{6,}\d)/g;
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const URL_LIKE = /\b(?:https?:\/\/|www\.)\S+/gi;
const MONEY_LIKE = /(?:[$£€R]|\bZAR\b|\bUSD\b)\s?\d[\d,]*(?:\.\d+)?/gi;

export function sanitizeStyleText(value: string, maxLen = 200): string {
  const redacted = String(value ?? "")
    .replace(PHONE_LIKE, "[redacted]")
    .replace(EMAIL_LIKE, "[redacted]")
    .replace(URL_LIKE, "[redacted]")
    .replace(MONEY_LIKE, "[redacted]")
    .trim();
  return redacted.slice(0, maxLen);
}

function sanitizeStyleList(values: unknown, maxItems = 8): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .slice(0, maxItems)
    .map((v) => sanitizeStyleText(v, 80));
}

export function parseAnalysisResponse(raw: unknown): ReferenceStyle {
  if (!raw || typeof raw !== "object") throw new Error("Unexpected response shape from reference analysis");
  const r = raw as Record<string, unknown>;
  const requiredStrings: (keyof ReferenceStyle)[] = [
    "layout_style",
    "subject_position",
    "visual_style",
    "background_style",
    "whitespace_level",
    "mood",
  ];
  for (const key of requiredStrings) {
    if (typeof r[key] !== "string") throw new Error(`Reference analysis is missing "${key}"`);
  }
  return {
    dominant_colors: sanitizeStyleList(r.dominant_colors, 6),
    layout_style: sanitizeStyleText(r.layout_style as string, 60),
    subject_position: sanitizeStyleText(r.subject_position as string, 80),
    text_regions: sanitizeStyleList(r.text_regions, 8),
    visual_style: sanitizeStyleText(r.visual_style as string, 200),
    background_style: sanitizeStyleText(r.background_style as string, 200),
    whitespace_level: sanitizeStyleText(r.whitespace_level as string, 60),
    mood: sanitizeStyleText(r.mood as string, 80),
  };
}

export type ReferenceAnalysisCredential = { apiKey: string; model: string };
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

// `imageDataUrl` must already be a `data:<mime>;base64,...` URL built
// server-side from bytes downloaded via the caller's own workspace-scoped
// storage read (see registerContentMediaAsset/mediaAssets.ts for the sibling
// pattern) - this module never accepts or fetches a path itself.
export async function analyzeReferenceStyle(
  cred: ReferenceAnalysisCredential,
  imageDataUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<ReferenceStyle> {
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${cred.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cred.model,
      store: false,
      instructions: buildAnalysisInstructions(),
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Analyze the visual style of this reference advert image." },
            { type: "input_image", image_url: imageDataUrl },
          ],
        },
      ],
      text: {
        verbosity: "low",
        format: { type: "json_schema", name: "stabiflow_reference_style", strict: true, schema: RESPONSE_SCHEMA },
      },
    }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`OpenAI failed (${response.status}): ${raw.slice(0, 400)}`);
  const data = JSON.parse(raw);
  let output = typeof data?.output_text === "string" ? data.output_text : "";
  if (!output) {
    for (const item of data?.output || []) {
      for (const part of item?.content || []) {
        if (part?.type === "output_text") output = part.text;
      }
    }
  }
  if (!output) throw new Error("OpenAI returned no structured output for reference analysis");
  return parseAnalysisResponse(JSON.parse(output));
}

// -- concept-prompt integration ---------------------------------------------
// Turns cached style + the user's toggles into guidance text appended to
// generateConcepts' buildInputText input. Guidance, not commercial fact -
// never includes anything from text_regions' wording (there is none) and
// is explicitly framed as inspiration, not a source of truth.
export function buildReferenceGuidanceText(style: ReferenceStyle, prefs: ReferencePreferences): string {
  if (prefs.fresh_layout && !prefs.keep_colours && !prefs.keep_layout && !prefs.keep_imagery) {
    return "A reference advert was provided but the user chose a fresh concept: use ONLY the workspace's Brand Kit for colours/branding and ignore this reference's layout and imagery entirely.";
  }
  const asks: string[] = [];
  if (prefs.keep_colours) asks.push(`let the reference's dominant colours (${style.dominant_colors.join(", ") || "as observed"}) strongly inform the generated background's palette`);
  if (prefs.keep_layout) asks.push(`use a similar composition/layout hierarchy to the reference (${style.layout_style}, subject ${style.subject_position}) - do not copy its exact artwork`);
  if (prefs.keep_imagery) asks.push(`preserve the reference's general visual subject/category and style (${style.visual_style}, ${style.background_style})`);
  if (asks.length === 0) {
    return `A reference advert was provided for inspiration only (mood: ${style.mood}, whitespace: ${style.whitespace_level}). Generate a genuinely new concept - do not reuse its exact layout or imagery.`;
  }
  return [
    "A reference advert was provided as style inspiration (never as content to copy, and its text/prices/contact details are irrelevant and unknown to you):",
    ...asks.map((a) => `- ${a}`),
    `Overall mood to echo: ${style.mood}. Whitespace level to echo: ${style.whitespace_level}.`,
    "Always generate a NEW background - never describe reusing the reference image itself.",
  ].join("\n");
}

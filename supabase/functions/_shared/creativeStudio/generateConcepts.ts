// Creative Studio batch image ads - stage 2: brief (+ already-generated
// copy) -> structured visual CONCEPTS. Same single-shot Responses API
// shape as generateCopy.ts (no streaming, no tools, strict JSON schema,
// store:false). Nothing here writes to any table - the edge function
// persists the returned concepts.
//
// Every concept carries a `visualPrompt` that describes ONLY the
// background/visual for the AI image layer. The image model is NEVER
// asked to render the headline, CTA, phone number, price, logo or any
// legal text - StabiFlow composites those deterministically afterwards.
// appendNoTextRule() below is applied to every prompt before it leaves
// this module, so a malformed or lazy model response can never produce a
// concept whose prompt lacks the no-text/no-logo guard.

export type ConceptCopySeed = {
  headline: string;
  primaryText: string;
  description: string;
  cta: string;
};

export type ConceptStudioInput = {
  businessContext: string; // required - what is being advertised
  audience?: string;
  tone?: string;
  conceptCount: number;
  // Optional: the copy the user already generated in stage 1, so the
  // model reuses/refines it instead of inventing unrelated wording.
  copySeeds?: ConceptCopySeed[];
  // Optional: pre-formatted guidance text derived from a reference
  // advert's cached style analysis (see analyzeReference.ts
  // buildReferenceGuidanceText). Style inspiration only - never treated
  // as a source of commercial fact, and it never overrides businessContext.
  referenceGuidance?: string;
  // Optional: free-text scene/mood direction the user typed for the
  // visual (one-click form's "Visual direction" field). Folded into the
  // background-only visualPrompt guidance - never a source of commercial
  // fact, and still subject to appendNoTextRule() like every other prompt.
  visualDirection?: string;
};

export type VisualConcept = {
  conceptName: string;
  headline: string;
  supportingText: string;
  cta: string;
  visualPrompt: string; // background/visual ONLY, always ends with the no-text rule
  layoutStyle: string;
  visualNotes: string;
};

export type ConceptStudioCredential = { apiKey: string; model: string };

const MIN_CONCEPTS = 1;
// V1 cap: at most 6 unique generated visuals per batch (instruction #10).
const MAX_CONCEPTS = 6;

export function clampConceptCount(requested: number): number {
  if (!Number.isFinite(requested)) return MIN_CONCEPTS;
  return Math.max(MIN_CONCEPTS, Math.min(MAX_CONCEPTS, Math.round(requested)));
}

// The mandatory negative-prompt rule. Appended to EVERY visual prompt so
// the image model produces a clean background with copy space and no
// baked-in text/branding. Instruction #3 / test #5.
export const NO_TEXT_RULE =
  "no text, no letters, no words, no numbers, no logos, no watermarks, no readable signage, no captions, leave clear negative space for marketing copy to be added later";

export function appendNoTextRule(prompt: string): string {
  const base = (prompt || "").trim().replace(/[.\s]+$/, "");
  if (!base) return NO_TEXT_RULE;
  // Idempotent - never double-append if the model already echoed it.
  if (base.toLowerCase().includes("no text") && base.toLowerCase().includes("no logos")) {
    return `${base}.`;
  }
  return `${base}. ${NO_TEXT_RULE}.`;
}

export function buildInstructions(): string {
  return [
    "You are a senior art director planning image ad concepts for a StabiFlow customer's own advertising campaigns.",
    "Return genuinely distinct concepts - different visual angles and emotional hooks, not paraphrases.",
    "For each concept provide: conceptName (a short internal label), headline (<=40 chars, Meta convention),",
    "supportingText (<=125 chars), cta (a short real call-to-action phrase, never a sentence),",
    "visualPrompt, layoutStyle, and visualNotes.",
    "CRITICAL: visualPrompt describes ONLY the photographic/illustrative BACKGROUND - subject, setting, mood, lighting, composition, and where the empty copy space sits.",
    "NEVER put headline text, CTA text, phone numbers, prices, logos, watermarks or any readable words in visualPrompt - StabiFlow adds all text deterministically afterwards.",
    "layoutStyle must be one of: split, full_bleed, bold_statement, professional_card.",
    "visualNotes: one line on colour palette / focal point / where text should overlay.",
    "Never invent specific facts, prices, discounts or claims the brief does not state. Never write in first person as the business.",
    "If reference-advert style guidance is provided, it describes VISUAL STYLE ONLY (colours/layout/imagery/mood) - never treat it as a source of product facts, prices, contact details or copy; the Business/product/service brief above it is always the sole source of commercial fact.",
  ].join(" ");
}

export function buildInputText(input: ConceptStudioInput): string {
  const parts = [`Business/product/service: ${input.businessContext.trim()}`];
  if (input.audience?.trim()) parts.push(`Target audience: ${input.audience.trim()}`);
  if (input.tone?.trim()) parts.push(`Tone: ${input.tone.trim()}`);
  if (input.copySeeds && input.copySeeds.length > 0) {
    parts.push("Marketing copy already approved for this campaign (reuse and adapt, do not contradict it):");
    input.copySeeds.slice(0, 5).forEach((s, i) => {
      parts.push(`  ${i + 1}. headline="${s.headline}" primary="${s.primaryText}" cta="${s.cta}"`);
    });
  }
  if (input.referenceGuidance?.trim()) {
    parts.push(input.referenceGuidance.trim());
  }
  if (input.visualDirection?.trim()) {
    parts.push(`Visual direction for the background (style/scene inspiration only, still no text/logos in visualPrompt): ${input.visualDirection.trim()}`);
  }
  parts.push(`Generate exactly ${clampConceptCount(input.conceptCount)} distinct visual concepts.`);
  return parts.join("\n");
}

const CONCEPT_SCHEMA = {
  type: "object",
  properties: {
    conceptName: { type: "string" },
    headline: { type: "string" },
    supportingText: { type: "string" },
    cta: { type: "string" },
    visualPrompt: { type: "string" },
    layoutStyle: { type: "string" },
    visualNotes: { type: "string" },
  },
  required: ["conceptName", "headline", "supportingText", "cta", "visualPrompt", "layoutStyle", "visualNotes"],
  additionalProperties: false,
};

const RESPONSE_SCHEMA = {
  type: "object",
  properties: { concepts: { type: "array", items: CONCEPT_SCHEMA } },
  required: ["concepts"],
  additionalProperties: false,
};

const ALLOWED_LAYOUT_STYLES = new Set(["split", "full_bleed", "bold_statement", "professional_card"]);

export function parseConceptsResponse(raw: unknown): VisualConcept[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { concepts?: unknown }).concepts)) {
    throw new Error("Unexpected response shape from concept generation");
  }
  const concepts = (raw as { concepts: unknown[] }).concepts;
  return concepts.map((c, i) => {
    if (!c || typeof c !== "object") throw new Error(`Concept ${i} is not an object`);
    const { conceptName, headline, supportingText, cta, visualPrompt, layoutStyle, visualNotes } = c as Record<string, unknown>;
    if (
      typeof conceptName !== "string" ||
      typeof headline !== "string" ||
      typeof supportingText !== "string" ||
      typeof cta !== "string" ||
      typeof visualPrompt !== "string" ||
      typeof layoutStyle !== "string" ||
      typeof visualNotes !== "string"
    ) {
      throw new Error(`Concept ${i} is missing a required text field`);
    }
    if (!conceptName.trim() || !headline.trim() || !supportingText.trim() || !cta.trim() || !visualPrompt.trim()) {
      throw new Error(`Concept ${i} has an empty required field`);
    }
    const normalizedLayout = ALLOWED_LAYOUT_STYLES.has(layoutStyle.trim().toLowerCase())
      ? layoutStyle.trim().toLowerCase()
      : "split";
    return {
      conceptName: conceptName.trim(),
      headline: headline.trim(),
      supportingText: supportingText.trim(),
      cta: cta.trim(),
      // The single choke point: no concept ever leaves this module with a
      // prompt that lacks the no-text/no-logo rule.
      visualPrompt: appendNoTextRule(visualPrompt),
      layoutStyle: normalizedLayout,
      visualNotes: visualNotes.trim(),
    };
  });
}

// User-supplied campaign text precedence (instruction #9): user text >
// AI-generated text > (brand-default CTA / system fallback, applied
// later by resolveCta in lib/adRenderer/layout.ts - out of scope here).
// A non-blank override is applied to EVERY concept verbatim - visual
// variety across concepts is preserved, campaign text is not. A blank/
// undefined override leaves the AI's own per-concept text untouched.
export type UserCopyOverride = { headline?: string; body?: string; cta?: string };

export function applyCopyOverrides(concepts: VisualConcept[], overrides: UserCopyOverride | undefined): VisualConcept[] {
  const headline = overrides?.headline?.trim();
  const body = overrides?.body?.trim();
  const cta = overrides?.cta?.trim();
  if (!headline && !body && !cta) return concepts;
  return concepts.map((c) => ({
    ...c,
    headline: headline || c.headline,
    supportingText: body || c.supportingText,
    cta: cta || c.cta,
  }));
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export async function generateVisualConcepts(
  cred: ConceptStudioCredential,
  input: ConceptStudioInput,
  fetchImpl: FetchLike = fetch,
): Promise<VisualConcept[]> {
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${cred.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cred.model,
      store: false,
      instructions: buildInstructions(),
      input: [{ role: "user", content: [{ type: "input_text", text: buildInputText(input) }] }],
      text: {
        verbosity: "medium",
        format: { type: "json_schema", name: "stabiflow_visual_concepts", strict: true, schema: RESPONSE_SCHEMA },
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
  if (!output) throw new Error("OpenAI returned no structured output");
  const parsed = parseConceptsResponse(JSON.parse(output));
  if (parsed.length === 0) throw new Error("Concept generation returned zero concepts");
  return parsed;
}

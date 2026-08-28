// Post-launch UI polish, Creative Studio V1. Mirrors
// _shared/inbox/aiReplyEngine.ts's pattern exactly: a single-shot,
// non-streaming call to OpenAI's Responses API with a strict JSON schema
// output - the same low-risk shape already proven for WhatsApp AI, not a
// second independent AI integration. Deliberately NOT Flow AI's
// streaming/tool-calling machinery - copy generation is one request in,
// N variations out, nothing to stream and nothing that needs a tool
// registry. Every output is inert text until the user explicitly copies
// or uses it elsewhere; nothing here ever writes to any other table.

export type CreativeStudioInput = {
  businessContext: string; // what the business/product/service is - required
  audience?: string; // who the ad is targeting, optional
  tone?: string; // e.g. "professional", "playful" - optional
  variantCount: number; // how many distinct variations to generate
};

export type CreativeVariant = {
  headline: string;
  primaryText: string;
  description: string;
  cta: string;
};

export type CreativeStudioCredential = { apiKey: string; model: string };

const MIN_VARIANTS = 1;
const MAX_VARIANTS = 5;

export function clampVariantCount(requested: number): number {
  if (!Number.isFinite(requested)) return MIN_VARIANTS;
  return Math.max(MIN_VARIANTS, Math.min(MAX_VARIANTS, Math.round(requested)));
}

export function buildInstructions(): string {
  return [
    "You write marketing ad copy for a StabiFlow customer's own advertising campaigns.",
    "Generate genuinely distinct variations - different angles/hooks, not paraphrases of each other.",
    "Headlines: at most 40 characters. Primary text: at most 125 characters. Description: at most 30 characters.",
    "These are Meta advertising copy length conventions - stay within them.",
    "CTA must be a short, real call-to-action phrase (e.g. \"Shop Now\", \"Learn More\", \"Book a Call\") - never a full sentence.",
    "Never invent specific facts, prices, discounts, or claims the business context does not state.",
    "Never write in first person as if you are the business owner - write copy FOR them to use.",
  ].join(" ");
}

export function buildInputText(input: CreativeStudioInput): string {
  const parts = [`Business/product/service: ${input.businessContext.trim()}`];
  if (input.audience?.trim()) parts.push(`Target audience: ${input.audience.trim()}`);
  if (input.tone?.trim()) parts.push(`Tone: ${input.tone.trim()}`);
  parts.push(`Generate exactly ${clampVariantCount(input.variantCount)} distinct variations.`);
  return parts.join("\n");
}

const VARIANT_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    primaryText: { type: "string" },
    description: { type: "string" },
    cta: { type: "string" },
  },
  required: ["headline", "primaryText", "description", "cta"],
  additionalProperties: false,
};

const RESPONSE_SCHEMA = {
  type: "object",
  properties: { variants: { type: "array", items: VARIANT_SCHEMA } },
  required: ["variants"],
  additionalProperties: false,
};

export function parseVariantsResponse(raw: unknown): CreativeVariant[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { variants?: unknown }).variants)) {
    throw new Error("Unexpected response shape from copy generation");
  }
  const variants = (raw as { variants: unknown[] }).variants;
  return variants.map((v, i) => {
    if (!v || typeof v !== "object") throw new Error(`Variant ${i} is not an object`);
    const { headline, primaryText, description, cta } = v as Record<string, unknown>;
    if (typeof headline !== "string" || typeof primaryText !== "string" || typeof description !== "string" || typeof cta !== "string") {
      throw new Error(`Variant ${i} is missing a required text field`);
    }
    return { headline, primaryText, description, cta };
  });
}

export async function generateCreativeCopy(cred: CreativeStudioCredential, input: CreativeStudioInput): Promise<CreativeVariant[]> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${cred.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cred.model,
      store: false,
      instructions: buildInstructions(),
      input: [{ role: "user", content: [{ type: "input_text", text: buildInputText(input) }] }],
      text: { verbosity: "low", format: { type: "json_schema", name: "stabiflow_creative_variants", strict: true, schema: RESPONSE_SCHEMA } },
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
  return parseVariantsResponse(JSON.parse(output));
}

// Creative Studio batch image ads - stage 3: the AI image layer.
//
// Generates ONE background/visual per concept (never per finished
// creative - instruction #10). The prompt is the concept's visualPrompt,
// which already carries the no-text/no-logo rule from generateConcepts.
// The output is a clean background image; StabiFlow's deterministic
// renderer composites all commercial text/logo/CTA on top afterwards.
//
// Provider abstraction: this is the ONLY place an image-generation
// provider is called. Credentials stay server-side (edge function env).
// fetchImpl is injectable so tests never hit the real API.

export type ImageCredential = { apiKey: string; model: string };

export type GeneratedVisual = {
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
  // Only what the provider actually reported - never fabricated. null
  // when the provider returns no usage block (e.g. dall-e-3).
  usage: { inputTokens: number; outputTokens: number } | null;
};

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

// Single generated source size. Portrait 2:3 gives every Meta target
// (1:1, 4:5, 9:16) a reasonable cover-crop without upscaling. The
// renderer never stretches - it crops to fill (see contentImageTransform).
const SOURCE_SIZE = "1024x1536";
const SOURCE_WIDTH = 1024;
const SOURCE_HEIGHT = 1536;

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function parseImageResponse(raw: unknown): { bytes: Uint8Array; usage: GeneratedVisual["usage"] } {
  if (!raw || typeof raw !== "object") throw new Error("Unexpected response shape from image generation");
  const data = (raw as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) throw new Error("Image generation returned no image data");
  const first = data[0] as Record<string, unknown>;
  const b64 = first?.b64_json;
  if (typeof b64 !== "string" || b64.length === 0) throw new Error("Image generation returned no b64_json payload");
  let usage: GeneratedVisual["usage"] = null;
  const u = (raw as { usage?: Record<string, unknown> }).usage;
  if (u && typeof u === "object") {
    const inputTokens = Number(u.input_tokens ?? u.prompt_tokens ?? 0);
    const outputTokens = Number(u.output_tokens ?? 0);
    if (Number.isFinite(inputTokens) && Number.isFinite(outputTokens) && (inputTokens > 0 || outputTokens > 0)) {
      usage = { inputTokens, outputTokens };
    }
  }
  return { bytes: decodeBase64(b64), usage };
}

export async function generateVisual(
  cred: ImageCredential,
  visualPrompt: string,
  fetchImpl: FetchLike = fetch,
): Promise<GeneratedVisual> {
  const response = await fetchImpl("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${cred.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cred.model,
      prompt: visualPrompt,
      n: 1,
      size: SOURCE_SIZE,
    }),
  });
  const rawText = await response.text();
  if (!response.ok) throw new Error(`Image provider failed (${response.status}): ${rawText.slice(0, 400)}`);
  const { bytes, usage } = parseImageResponse(JSON.parse(rawText));
  return { bytes, mimeType: "image/png", width: SOURCE_WIDTH, height: SOURCE_HEIGHT, usage };
}

import { assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateVisual, parseImageResponse } from "./generateVisual.ts";

// 1x1 transparent PNG.
const PNG_1PX_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

Deno.test("parseImageResponse: decodes b64_json into bytes", () => {
  const { bytes, usage } = parseImageResponse({ data: [{ b64_json: PNG_1PX_B64 }] });
  assertEquals(bytes[0], 0x89);
  assertEquals(bytes[1], 0x50);
  assertEquals(usage, null); // no usage block -> null, never fabricated
});

Deno.test("parseImageResponse: keeps real usage numbers when the provider reports them", () => {
  const { usage } = parseImageResponse({ data: [{ b64_json: PNG_1PX_B64 }], usage: { input_tokens: 120, output_tokens: 900 } });
  assertEquals(usage, { inputTokens: 120, outputTokens: 900 });
});

Deno.test("parseImageResponse: throws on an empty data array", () => {
  assertThrows(() => parseImageResponse({ data: [] }), Error, "no image data");
});
Deno.test("parseImageResponse: throws when b64_json is missing", () => {
  assertThrows(() => parseImageResponse({ data: [{ url: "https://x" }] }), Error, "no b64_json");
});

Deno.test("generateVisual: a provider failure surfaces as a thrown error (no fabricated image)", async () => {
  const fakeFetch = () => Promise.resolve(new Response("rate limited", { status: 429 }));
  await assertRejects(
    () => generateVisual({ apiKey: "k", model: "gpt-image-1" }, "a prompt", fakeFetch as unknown as typeof fetch),
    Error,
    "Image provider failed (429)",
  );
});

Deno.test("generateVisual: success path returns bytes + source dimensions", async () => {
  const fakeFetch = (_url: string, _init: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify({ data: [{ b64_json: PNG_1PX_B64 }] }), { status: 200 }));
  const out = await generateVisual({ apiKey: "k", model: "gpt-image-1" }, "a prompt", fakeFetch as unknown as typeof fetch);
  assertEquals(out.mimeType, "image/png");
  assertEquals(out.width, 1024);
  assertEquals(out.height, 1536);
  assertEquals(out.usage, null);
});

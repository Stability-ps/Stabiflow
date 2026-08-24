import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { generateContainVariant, sha256Hex } from "./contentImageProcessor.ts";
import { INSTAGRAM_SQUARE_TARGET } from "./contentImageTransform.ts";

async function makeTestJpeg(width: number, height: number): Promise<Uint8Array> {
  const img = new Image(width, height);
  img.fill(Image.rgbaToColor(30, 120, 200, 255));
  return await img.encodeJPEG(90);
}

Deno.test("REGRESSION (production case): a real 1536x1024 JPEG produces a valid 1080x1080 Instagram variant end-to-end", async () => {
  const sourceBytes = await makeTestJpeg(1536, 1024);
  const variant = await generateContainVariant(sourceBytes, "image/jpeg", INSTAGRAM_SQUARE_TARGET);

  assertEquals(variant.width, 1080);
  assertEquals(variant.height, 1080);
  assertEquals(variant.mimeType, "image/jpeg");
  assertEquals(variant.transformationMetadata.scaledWidth, 1080);
  assertEquals(variant.transformationMetadata.scaledHeight, 720);

  // Prove the output is actually a real, decodable image at the claimed
  // dimensions - not just a metadata claim.
  const decoded = await Image.decode(variant.bytes);
  assertEquals(decoded.width, 1080);
  assertEquals(decoded.height, 1080);
  assert(variant.bytes.byteLength > 0);
});

Deno.test("a PNG source stays PNG in the output (transparency-preserving formats aren't silently converted)", async () => {
  const img = new Image(800, 800);
  img.fill(Image.rgbaToColor(10, 200, 10, 255));
  const pngBytes = await img.encode();
  const variant = await generateContainVariant(pngBytes, "image/png", INSTAGRAM_SQUARE_TARGET);
  assertEquals(variant.mimeType, "image/png");
  const decoded = await Image.decode(variant.bytes);
  assertEquals(decoded.width, 1080);
});

Deno.test("upscaling a small source still produces the full target dimensions without stretching", async () => {
  const sourceBytes = await makeTestJpeg(300, 300);
  const variant = await generateContainVariant(sourceBytes, "image/jpeg", INSTAGRAM_SQUARE_TARGET);
  assertEquals(variant.width, 1080);
  assertEquals(variant.height, 1080);
  // Square source into square target: fills the whole frame, no padding.
  assertEquals(variant.transformationMetadata.fillRatio, 1);
});

Deno.test("sha256Hex produces a deterministic 64-char hex digest for the same bytes", async () => {
  const bytes = await makeTestJpeg(100, 100);
  const a = await sha256Hex(bytes);
  const b = await sha256Hex(bytes);
  assertEquals(a, b);
  assertEquals(a.length, 64);
  assertEquals(/^[0-9a-f]{64}$/.test(a), true);
});

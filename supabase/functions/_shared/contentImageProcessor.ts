// Actual pixel manipulation for the platform-variant pipeline. Uses
// ImageScript (pure WASM, Deno-native - no native binaries, works in the
// edge function runtime unlike sharp/libvips).
//
// Ported unchanged from Acapolite's _shared/socialImageProcessor.ts.
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { computeContainLayout, type ImageTarget } from "./contentImageTransform.ts";

export type GeneratedVariant = {
  bytes: Uint8Array;
  width: number;
  height: number;
  mimeType: string;
  transformationMetadata: {
    method: "contain";
    sourceWidth: number;
    sourceHeight: number;
    targetWidth: number;
    targetHeight: number;
    scaledWidth: number;
    scaledHeight: number;
    offsetX: number;
    offsetY: number;
    fillRatio: number;
    backgroundColor: string;
  };
};

const BACKGROUND_RGBA: [number, number, number, number] = [255, 255, 255, 255]; // white pad - never crops content

// Scales the source to fit entirely within `target` (preserving aspect
// ratio - never stretches), centers it on a `target`-sized canvas padded
// with a solid background, and re-encodes. The full original content is
// always present in the output; only the amount of padding varies.
export async function generateContainVariant(sourceBytes: Uint8Array, sourceMimeType: string, target: ImageTarget): Promise<GeneratedVariant> {
  const source = await Image.decode(sourceBytes);
  const layout = computeContainLayout(source.width, source.height, target);

  const resized = source.clone().resize(layout.scaledWidth, layout.scaledHeight);
  const canvas = new Image(target.width, target.height);
  canvas.fill(Image.rgbaToColor(...BACKGROUND_RGBA));
  canvas.composite(resized, layout.offsetX, layout.offsetY);

  const preservePng = sourceMimeType === "image/png";
  const bytes = preservePng ? await canvas.encode() : await canvas.encodeJPEG(85);

  return {
    bytes,
    width: target.width,
    height: target.height,
    mimeType: preservePng ? "image/png" : "image/jpeg",
    transformationMetadata: {
      method: "contain",
      sourceWidth: source.width,
      sourceHeight: source.height,
      targetWidth: target.width,
      targetHeight: target.height,
      scaledWidth: layout.scaledWidth,
      scaledHeight: layout.scaledHeight,
      offsetX: layout.offsetX,
      offsetY: layout.offsetY,
      fillRatio: layout.fillRatio,
      backgroundColor: "#ffffff",
    },
  };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

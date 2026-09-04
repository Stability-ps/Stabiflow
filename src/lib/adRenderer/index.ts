export * from "./spec";
export * from "./layout";
export {
  renderAd,
  computeCoverRect,
  computeContainRect,
  type RenderAssets,
  type RenderAdResult,
  type DrawableImage,
} from "./canvas";

// Browser helpers - not imported by the pure layout tests.

export async function loadDrawableImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url.slice(0, 80)}`));
    img.src = url;
  });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(binary);
}

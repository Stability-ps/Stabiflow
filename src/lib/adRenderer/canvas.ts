// Rasterises an AdLayoutPlan (from layout.ts) to a PNG Blob using a 2D
// canvas context. This is the "deterministic StabiFlow ad renderer":
// given the same plan + the same source bitmaps it always produces the
// same pixels. It never calls an image-generation provider - the only
// external input is the already-fetched background/logo bitmap.
//
// The canvas factory is injectable so unit tests can run without a real
// browser canvas (jsdom has none) and assert exactly which strings were
// drawn and at what size.

import type { AdLayoutPlan, TextElement } from "./layout";

export type DrawableImage = CanvasImageSource & { width: number; height: number };

export type Ctx2DLike = {
  canvas: { width: number; height: number };
  fillStyle: string | CanvasGradient;
  font: string;
  textBaseline: string;
  textAlign: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): { width: number };
  drawImage(image: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
  save(): void;
  restore(): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
};

export type CanvasLike = {
  width: number;
  height: number;
  getContext(type: "2d"): Ctx2DLike | null;
  convertToBlob?: (options?: { type?: string }) => Promise<Blob>;
  toBlob?: (cb: (blob: Blob | null) => void, type?: string) => void;
};

export type CreateCanvas = (width: number, height: number) => CanvasLike;

const FONT_STACK =
  '"Inter","Helvetica Neue",Helvetica,Arial,"Segoe UI",Roboto,system-ui,sans-serif';

function defaultCreateCanvas(width: number, height: number): CanvasLike {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height) as unknown as CanvasLike;
  }
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    return c as unknown as CanvasLike;
  }
  throw new Error("No canvas implementation available in this environment");
}

async function canvasToBlob(canvas: CanvasLike): Promise<Blob> {
  if (typeof canvas.convertToBlob === "function") {
    return canvas.convertToBlob({ type: "image/png" });
  }
  if (typeof canvas.toBlob === "function") {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob!((blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null"))), "image/png");
    });
  }
  throw new Error("Canvas has no blob export method");
}

// Aspect-preserving cover: fill the destination box, cropping the
// overflow, never stretching. Mirrors the "cover/crop" rule in
// instruction #9 (the contain path lives in contentImageTransform.ts for
// the separate platform-variant pipeline).
export function computeCoverRect(srcW: number, srcH: number, dstW: number, dstH: number) {
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const cropW = dstW / scale;
  const cropH = dstH / scale;
  return {
    sx: Math.max(0, (srcW - cropW) / 2),
    sy: Math.max(0, (srcH - cropH) / 2),
    sw: Math.min(srcW, cropW),
    sh: Math.min(srcH, cropH),
  };
}

export function computeContainRect(srcW: number, srcH: number, dstW: number, dstH: number) {
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { dx: (dstW - w) / 2, dy: (dstH - h) / 2, dw: w, dh: h };
}

function wrapLines(ctx: Ctx2DLike, textValue: string, maxWidth: number): string[] {
  const words = textValue.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

// Fit a text element: shrink from fontSize toward minFontSize until the
// wrapped copy fits maxLines. If it still does not fit at the floor we
// report overflow and draw what fits - we NEVER truncate the stored
// string with an ellipsis or silently drop it (instruction #16 / test).
function drawText(ctx: Ctx2DLike, el: TextElement): { overflow: boolean } {
  const display = el.uppercase ? el.text.toUpperCase() : el.text;
  let fontSize = el.fontSize;
  let lines: string[] = [];
  let fits = false;
  while (fontSize >= el.minFontSize) {
    ctx.font = `${el.fontWeight} ${fontSize}px ${FONT_STACK}`;
    lines = wrapLines(ctx, display, el.maxWidth);
    if (lines.length <= el.maxLines) {
      fits = true;
      break;
    }
    fontSize -= 2;
  }
  if (!fits) {
    ctx.font = `${el.fontWeight} ${el.minFontSize}px ${FONT_STACK}`;
    fontSize = el.minFontSize;
    lines = wrapLines(ctx, display, el.maxWidth);
  }
  ctx.textBaseline = "top";
  ctx.textAlign = el.align;
  ctx.fillStyle = el.color;
  const lineStep = fontSize * el.lineHeight;
  const drawnLines = fits ? lines : lines.slice(0, el.maxLines);
  let anchorX = el.x;
  if (el.align === "center") anchorX = el.x + el.maxWidth / 2;
  else if (el.align === "right") anchorX = el.x + el.maxWidth;
  drawnLines.forEach((line, i) => {
    ctx.fillText(line, anchorX, el.y + i * lineStep, el.maxWidth);
  });
  return { overflow: !fits };
}

export type RenderAssets = {
  background?: DrawableImage | null;
  logo?: DrawableImage | null;
};

export type RenderAdResult = { blob: Blob; overflow: boolean; width: number; height: number };

export async function renderAd(
  plan: AdLayoutPlan,
  assets: RenderAssets = {},
  options: { createCanvas?: CreateCanvas } = {},
): Promise<RenderAdResult> {
  const createCanvas = options.createCanvas ?? defaultCreateCanvas;
  const canvas = createCanvas(plan.width, plan.height);
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not acquire a 2D canvas context");

  ctx.fillStyle = plan.backgroundFallback;
  ctx.fillRect(0, 0, plan.width, plan.height);

  let overflow = false;

  for (const el of plan.elements) {
    if (el.kind === "rect") {
      ctx.fillStyle = el.color;
      ctx.fillRect(el.x, el.y, el.w, el.h);
    } else if (el.kind === "gradient") {
      const grad =
        el.direction === "vertical"
          ? ctx.createLinearGradient(el.x, el.y, el.x, el.y + el.h)
          : ctx.createLinearGradient(el.x, el.y, el.x + el.w, el.y);
      grad.addColorStop(0, el.from);
      grad.addColorStop(1, el.to);
      ctx.fillStyle = grad;
      ctx.fillRect(el.x, el.y, el.w, el.h);
    } else if (el.kind === "image") {
      const img = el.source === "background" ? assets.background : assets.logo;
      if (!img) {
        // No asset: leave the fallback fill / underlying rect showing.
        continue;
      }
      if (el.fit === "cover") {
        const { sx, sy, sw, sh } = computeCoverRect(img.width, img.height, el.w, el.h);
        ctx.save();
        ctx.beginPath();
        ctx.rect(el.x, el.y, el.w, el.h);
        ctx.clip();
        ctx.drawImage(img, sx, sy, sw, sh, el.x, el.y, el.w, el.h);
        ctx.restore();
      } else {
        const { dx, dy, dw, dh } = computeContainRect(img.width, img.height, el.w, el.h);
        ctx.drawImage(img, 0, 0, img.width, img.height, el.x + dx, el.y + dy, dw, dh);
      }
    } else if (el.kind === "text") {
      const res = drawText(ctx, el);
      if (res.overflow) overflow = true;
    }
  }

  const blob = await canvasToBlob(canvas);
  return { blob, overflow, width: plan.width, height: plan.height };
}

// Deterministic ad layout planner - PURE, no canvas, fully unit-testable.
//
// computeAdLayout() turns stored ad copy + brand kit + a layout/size
// choice into an ordered list of primitive draw instructions (rect /
// gradient / image / text). The canvas module (canvas.ts) rasterises the
// plan; it never decides *what* to draw.
//
// The exact commercial wording (headline / body / CTA / contact / price /
// disclaimer) is passed straight through into `text` elements verbatim -
// it is NEVER uppercased-in-place, truncated, or reworded here. The
// `uppercase` flag is a presentation hint the renderer applies visually
// while keeping the underlying string intact.

import { AD_SIZE_DIMENSIONS, type AdLayoutKind, type AdSizeKind } from "./spec";

export type RenderColor = string;

export type TextRole = "headline" | "body" | "cta" | "contact" | "price" | "disclaimer" | "brandname";

export type TextElement = {
  kind: "text";
  role: TextRole;
  text: string;
  x: number;
  y: number;
  maxWidth: number;
  fontSize: number;
  minFontSize: number;
  lineHeight: number;
  fontWeight: number;
  color: RenderColor;
  align: "left" | "center" | "right";
  maxLines: number;
  uppercase: boolean;
  letterSpacing: number;
};

export type RectElement = {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  color: RenderColor;
  radius: number;
};

export type GradientElement = {
  kind: "gradient";
  x: number;
  y: number;
  w: number;
  h: number;
  from: RenderColor;
  to: RenderColor;
  direction: "vertical" | "horizontal";
};

export type ImageElement = {
  kind: "image";
  source: "background" | "logo";
  x: number;
  y: number;
  w: number;
  h: number;
  fit: "cover" | "contain";
};

export type RenderElement = TextElement | RectElement | GradientElement | ImageElement;

export type BrandKit = {
  primary: RenderColor;
  accent: RenderColor;
  ctaText?: RenderColor | null;
};

export type AdRenderInput = {
  layout: AdLayoutKind;
  size: AdSizeKind;
  headline: string;
  body: string;
  cta: string;
  brandName: string;
  contact?: string | null;
  price?: string | null;
  disclaimer?: string | null;
  hasLogo: boolean;
  hasBackground: boolean;
  brand: BrandKit;
};

export type AdLayoutPlan = {
  width: number;
  height: number;
  backgroundFallback: RenderColor;
  elements: RenderElement[];
  // Rough, measurement-free estimate. The canvas renderer produces the
  // authoritative overflow flag; this lets pure tests assert that an
  // absurd headline is flagged rather than silently accepted.
  overflowRisk: boolean;
};

const DEFAULT_PRIMARY = "#1f2937";
const DEFAULT_ACCENT = "#2563eb";

function normalizeHex(value: RenderColor | null | undefined, fallback: RenderColor): RenderColor {
  if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim())) return value.trim().toLowerCase();
  return fallback;
}

export function relativeLuminance(hex: RenderColor): number {
  const h = normalizeHex(hex, "#000000").slice(1);
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function contrastText(bg: RenderColor): RenderColor {
  return relativeLuminance(bg) > 0.45 ? "#111827" : "#ffffff";
}

// Average proportional glyph advance as a fraction of font size. Used
// only for the measurement-free overflow estimate.
const GLYPH_ADVANCE = 0.54;

function estimateLineCapacity(maxWidth: number, fontSize: number): number {
  return Math.max(1, Math.floor(maxWidth / (fontSize * GLYPH_ADVANCE)));
}

function estimateFits(text: string, el: { maxWidth: number; minFontSize: number; maxLines: number }): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const perLine = estimateLineCapacity(el.maxWidth, el.minFontSize);
  let lines = 1;
  let col = 0;
  for (const w of words) {
    const wlen = w.length + (col === 0 ? 0 : 1);
    if (col + wlen > perLine && col > 0) {
      lines += 1;
      col = w.length;
    } else {
      col += wlen;
    }
    if (w.length > perLine) return false; // a single unbreakable word overflows
  }
  return lines <= el.maxLines;
}

function text(role: TextRole, value: string, opts: Partial<TextElement> & Pick<TextElement, "x" | "y" | "maxWidth" | "fontSize">): TextElement {
  return {
    kind: "text",
    role,
    text: value,
    minFontSize: Math.round(opts.fontSize * 0.6),
    lineHeight: 1.18,
    fontWeight: 400,
    color: "#111827",
    align: "left",
    maxLines: 3,
    uppercase: false,
    letterSpacing: 0,
    ...opts,
  };
}

function ctaPill(
  cx: number,
  cy: number,
  labelWidth: number,
  fontSize: number,
  fill: RenderColor,
  label: string,
  align: "left" | "center",
  brand: BrandKit,
): RenderElement[] {
  const padX = Math.round(fontSize * 1.1);
  const padY = Math.round(fontSize * 0.7);
  const w = Math.min(labelWidth + padX * 2, Math.round(fontSize * 22));
  const h = fontSize + padY * 2;
  const x = align === "center" ? Math.round(cx - w / 2) : cx;
  return [
    { kind: "rect", x, y: cy, w, h, color: fill, radius: Math.round(h / 2) },
    text("cta", label, {
      x: x + padX,
      y: cy + padY,
      maxWidth: w - padX * 2,
      fontSize,
      minFontSize: Math.round(fontSize * 0.75),
      fontWeight: 700,
      color: normalizeHex(brand.ctaText ?? null, contrastText(fill)),
      align: align === "center" ? "center" : "left",
      maxLines: 1,
      uppercase: true,
      letterSpacing: 0.5,
    }),
  ];
}

export function computeAdLayout(input: AdRenderInput): AdLayoutPlan {
  const { width, height } = AD_SIZE_DIMENSIONS[input.size];
  const primary = normalizeHex(input.brand.primary, DEFAULT_PRIMARY);
  const accent = normalizeHex(input.brand.accent, DEFAULT_ACCENT);
  const brand: BrandKit = { primary, accent, ctaText: input.brand.ctaText ?? null };
  const margin = Math.round(width * 0.066);
  // Story/Reel keeps the top and bottom ~12% clear of critical text.
  const verticalSafe = input.size === "1080x1920" ? Math.round(height * 0.12) : margin;

  const elements: RenderElement[] = [];
  const roughOverflow: boolean[] = [];
  const track = (el: TextElement) => {
    roughOverflow.push(!estimateFits(el.uppercase ? el.text.toUpperCase() : el.text, el));
    return el;
  };

  const backgroundFallback = input.layout === "professional_card" ? "#0f172a" : primary;
  const estCtaWidth = (fs: number) => Math.round(input.cta.length * fs * GLYPH_ADVANCE);

  if (input.layout === "split") {
    const panelW = Math.round(width * 0.48);
    // Visual on the right (or a tinted block if there's no background).
    if (input.hasBackground) {
      elements.push({ kind: "image", source: "background", x: panelW, y: 0, w: width - panelW, h: height, fit: "cover" });
    } else {
      elements.push({ kind: "rect", x: panelW, y: 0, w: width - panelW, h: height, color: accent, radius: 0 });
    }
    elements.push({ kind: "rect", x: 0, y: 0, w: panelW, h: height, color: primary, radius: 0 });
    const innerW = panelW - margin * 2;
    let y = verticalSafe;
    const onPrimary = contrastText(primary);
    if (input.hasLogo) {
      elements.push({ kind: "image", source: "logo", x: margin, y, w: Math.round(innerW * 0.42), h: Math.round(width * 0.11), fit: "contain" });
      y += Math.round(width * 0.11) + Math.round(margin * 0.8);
    } else {
      elements.push(track(text("brandname", input.brandName, { x: margin, y, maxWidth: innerW, fontSize: Math.round(width * 0.032), fontWeight: 700, color: onPrimary, maxLines: 2, uppercase: true, letterSpacing: 1 })));
      y += Math.round(width * 0.032 * 2.2);
    }
    const headlineFs = Math.round(width * 0.082);
    const headlineEl = track(text("headline", input.headline, { x: margin, y, maxWidth: innerW, fontSize: headlineFs, fontWeight: 800, color: onPrimary, lineHeight: 1.08, maxLines: 4 }));
    elements.push(headlineEl);
    y += headlineFs * 1.1 * Math.min(4, Math.max(2, Math.ceil(input.headline.length / 18)));
    const bodyFs = Math.round(width * 0.036);
    elements.push(track(text("body", input.body, { x: margin, y, maxWidth: innerW, fontSize: bodyFs, color: onPrimary, maxLines: 5, lineHeight: 1.3 })));
    const ctaFs = Math.round(width * 0.036);
    const ctaY = height - verticalSafe - (ctaFs + Math.round(ctaFs * 0.7) * 2) - (input.disclaimer ? Math.round(width * 0.05) : 0);
    ctaPill(margin, ctaY, estCtaWidth(ctaFs), ctaFs, accent, input.cta, "left", brand).forEach((e) => elements.push(e));
    if (input.disclaimer) {
      elements.push(track(text("disclaimer", input.disclaimer, { x: margin, y: height - verticalSafe + Math.round(margin * 0.2), maxWidth: innerW, fontSize: Math.round(width * 0.019), color: onPrimary, maxLines: 2, lineHeight: 1.2 })));
    }
  } else if (input.layout === "full_bleed") {
    if (input.hasBackground) {
      elements.push({ kind: "image", source: "background", x: 0, y: 0, w: width, h: height, fit: "cover" });
    } else {
      elements.push({ kind: "rect", x: 0, y: 0, w: width, h: height, color: primary, radius: 0 });
    }
    const scrimTop = Math.round(height * 0.42);
    elements.push({ kind: "gradient", x: 0, y: scrimTop, w: width, h: height - scrimTop, from: "rgba(0,0,0,0)", to: "rgba(0,0,0,0.82)", direction: "vertical" });
    const innerW = width - margin * 2;
    const ctaFs = Math.round(width * 0.038);
    const ctaBlockH = ctaFs + Math.round(ctaFs * 0.7) * 2;
    let y = height - verticalSafe - ctaBlockH - Math.round(width * 0.02);
    ctaPill(margin, y, estCtaWidth(ctaFs), ctaFs, accent, input.cta, "left", brand).forEach((e) => elements.push(e));
    const bodyFs = Math.round(width * 0.034);
    y -= Math.round(bodyFs * 1.3 * 3) + Math.round(width * 0.02);
    elements.push(track(text("body", input.body, { x: margin, y, maxWidth: innerW, fontSize: bodyFs, color: "#f8fafc", maxLines: 3, lineHeight: 1.3 })));
    const headlineFs = Math.round(width * 0.072);
    y -= Math.round(headlineFs * 1.1 * 3);
    elements.push(track(text("headline", input.headline, { x: margin, y, maxWidth: innerW, fontSize: headlineFs, fontWeight: 800, color: "#ffffff", lineHeight: 1.06, maxLines: 4 })));
    if (input.hasLogo) {
      elements.push({ kind: "image", source: "logo", x: margin, y: verticalSafe, w: Math.round(width * 0.26), h: Math.round(width * 0.1), fit: "contain" });
    } else {
      elements.push(track(text("brandname", input.brandName, { x: margin, y: verticalSafe, maxWidth: innerW, fontSize: Math.round(width * 0.03), fontWeight: 700, color: "#ffffff", maxLines: 1, uppercase: true, letterSpacing: 1 })));
    }
    if (input.disclaimer) {
      elements.push(track(text("disclaimer", input.disclaimer, { x: margin, y: height - Math.round(verticalSafe * 0.55), maxWidth: innerW, fontSize: Math.round(width * 0.018), color: "#e2e8f0", maxLines: 2, lineHeight: 1.2 })));
    }
  } else if (input.layout === "bold_statement") {
    if (input.hasBackground) {
      elements.push({ kind: "image", source: "background", x: 0, y: 0, w: width, h: height, fit: "cover" });
    } else {
      elements.push({ kind: "rect", x: 0, y: 0, w: width, h: height, color: primary, radius: 0 });
    }
    elements.push({ kind: "gradient", x: 0, y: 0, w: width, h: height, from: "rgba(0,0,0,0.55)", to: "rgba(0,0,0,0.62)", direction: "vertical" });
    const innerW = width - margin * 2;
    if (input.hasLogo) {
      elements.push({ kind: "image", source: "logo", x: Math.round(width / 2 - width * 0.14), y: verticalSafe, w: Math.round(width * 0.28), h: Math.round(width * 0.1), fit: "contain" });
    } else {
      elements.push(track(text("brandname", input.brandName, { x: margin, y: verticalSafe, maxWidth: innerW, fontSize: Math.round(width * 0.03), fontWeight: 700, color: "#ffffff", align: "center", maxLines: 1, uppercase: true, letterSpacing: 2 })));
    }
    const headlineFs = Math.round(width * 0.12);
    elements.push(track(text("headline", input.headline, { x: margin, y: Math.round(height * 0.34), maxWidth: innerW, fontSize: headlineFs, fontWeight: 900, color: "#ffffff", align: "center", lineHeight: 1.02, maxLines: 4 })));
    const ctaFs = Math.round(width * 0.042);
    ctaPill(width / 2, Math.round(height * 0.68), estCtaWidth(ctaFs), ctaFs, accent, input.cta, "center", brand).forEach((e) => elements.push(e));
    if (input.disclaimer) {
      elements.push(track(text("disclaimer", input.disclaimer, { x: margin, y: height - Math.round(verticalSafe * 0.6), maxWidth: innerW, fontSize: Math.round(width * 0.018), color: "#e2e8f0", align: "center", maxLines: 2, lineHeight: 1.2 })));
    }
  } else {
    // professional_card
    const imageH = Math.round(height * 0.56);
    if (input.hasBackground) {
      elements.push({ kind: "image", source: "background", x: 0, y: 0, w: width, h: imageH, fit: "cover" });
    } else {
      elements.push({ kind: "rect", x: 0, y: 0, w: width, h: imageH, color: accent, radius: 0 });
    }
    elements.push({ kind: "rect", x: 0, y: imageH, w: width, h: height - imageH, color: "#ffffff", radius: 0 });
    const innerW = width - margin * 2;
    let y = imageH + margin;
    if (input.hasLogo) {
      elements.push({ kind: "image", source: "logo", x: margin, y, w: Math.round(width * 0.3), h: Math.round(width * 0.1), fit: "contain" });
      y += Math.round(width * 0.1) + Math.round(margin * 0.5);
    } else {
      elements.push(track(text("brandname", input.brandName, { x: margin, y, maxWidth: innerW, fontSize: Math.round(width * 0.028), fontWeight: 700, color: accent, maxLines: 1, uppercase: true, letterSpacing: 1 })));
      y += Math.round(width * 0.028 * 2);
    }
    const headlineFs = Math.round(width * 0.058);
    elements.push(track(text("headline", input.headline, { x: margin, y, maxWidth: innerW, fontSize: headlineFs, fontWeight: 800, color: "#0f172a", lineHeight: 1.1, maxLines: 3 })));
    y += Math.round(headlineFs * 1.15 * Math.min(3, Math.max(1, Math.ceil(input.headline.length / 24))));
    const bodyFs = Math.round(width * 0.03);
    elements.push(track(text("body", input.body, { x: margin, y, maxWidth: innerW, fontSize: bodyFs, color: "#475569", maxLines: 3, lineHeight: 1.32 })));
    y += Math.round(bodyFs * 1.32 * 3) + Math.round(margin * 0.4);
    const infoBits = [input.price?.trim(), input.contact?.trim()].filter(Boolean) as string[];
    if (infoBits.length) {
      elements.push(track(text(input.price?.trim() ? "price" : "contact", infoBits.join("  •  "), { x: margin, y, maxWidth: innerW, fontSize: Math.round(width * 0.028), fontWeight: 700, color: "#0f172a", maxLines: 1 })));
      y += Math.round(width * 0.028 * 1.8);
    }
    const ctaFs = Math.round(width * 0.032);
    ctaPill(margin, height - margin - (ctaFs + Math.round(ctaFs * 0.7) * 2), estCtaWidth(ctaFs), ctaFs, accent, input.cta, "left", brand).forEach((e) => elements.push(e));
    if (input.disclaimer) {
      elements.push(track(text("disclaimer", input.disclaimer, { x: margin, y: height - Math.round(margin * 0.55), maxWidth: innerW, fontSize: Math.round(width * 0.016), color: "#94a3b8", maxLines: 1, lineHeight: 1.15 })));
    }
  }

  return {
    width,
    height,
    backgroundFallback,
    elements,
    overflowRisk: roughOverflow.some(Boolean),
  };
}

// Convenience for callers/tests: every text string the plan will draw,
// in paint order, exactly as stored.
export function planTextStrings(plan: AdLayoutPlan): string[] {
  return plan.elements.filter((e): e is TextElement => e.kind === "text").map((e) => e.text);
}

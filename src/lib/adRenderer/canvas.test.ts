import { describe, expect, it } from "vitest";
import { computeContainRect, computeCoverRect, renderAd, type CanvasLike, type Ctx2DLike } from "./canvas";
import { computeAdLayout, type AdRenderInput } from "./layout";

const BASE: AdRenderInput = {
  layout: "split",
  size: "1080x1080",
  headline: "Take back your Tuesday",
  body: "StabiFlow automates the follow-ups.",
  cta: "Start free trial",
  brandName: "StabiFlow",
  contact: null,
  price: null,
  disclaimer: null,
  hasLogo: false,
  hasBackground: true,
  brand: { primary: "#0f766e", accent: "#f97316", ctaText: null },
};

type Rec = { fillTextCalls: { text: string; x: number; y: number }[]; drawImageCalls: unknown[][]; canvasSize: { w: number; h: number } };

function makeFakeCanvas(glyphWidth: number): { canvas: CanvasLike; rec: Rec } {
  const rec: Rec = { fillTextCalls: [], drawImageCalls: [], canvasSize: { w: 0, h: 0 } };
  const ctx: Ctx2DLike = {
    canvas: { width: 0, height: 0 },
    fillStyle: "",
    font: "",
    textBaseline: "",
    textAlign: "",
    fillRect: () => {},
    fillText: (text, x, y) => rec.fillTextCalls.push({ text, x, y }),
    measureText: (text: string) => ({ width: text.length * glyphWidth }),
    drawImage: (...args: unknown[]) => rec.drawImageCalls.push(args),
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    rect: () => {},
    clip: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }) as unknown as CanvasGradient,
  };
  const canvas: CanvasLike = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    convertToBlob: async () => {
      rec.canvasSize = { w: canvas.width, h: canvas.height };
      return new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    },
  };
  return { canvas, rec };
}

describe("renderAd - deterministic composition", () => {
  it("renders at the plan's exact dimensions and draws the exact stored headline", async () => {
    const plan = computeAdLayout(BASE);
    const { canvas, rec } = makeFakeCanvas(10);
    const res = await renderAd(plan, {}, { createCanvas: () => canvas });
    expect(res.width).toBe(1080);
    expect(res.height).toBe(1080);
    expect(rec.canvasSize).toEqual({ w: 1080, h: 1080 });
    const allText = rec.fillTextCalls.map((c) => c.text).join(" ");
    // "Take back your Tuesday" wraps into words but every word is drawn, verbatim, no ellipsis.
    expect(allText).toContain("Take");
    expect(allText).toContain("Tuesday");
    expect(allText).not.toContain("…");
    expect(allText).not.toContain("...");
  });

  it("1080x1920 story size composites at 1080x1920", async () => {
    const plan = computeAdLayout({ ...BASE, size: "1080x1920", layout: "full_bleed" });
    const { canvas, rec } = makeFakeCanvas(8);
    await renderAd(plan, {}, { createCanvas: () => canvas });
    expect(rec.canvasSize).toEqual({ w: 1080, h: 1920 });
  });

  it("reports overflow (never truncates) when a huge headline cannot fit even at the min font size", async () => {
    const longHeadline = "Absolutely enormous headline that keeps going and going far past any panel width imaginable at any size";
    const plan = computeAdLayout({ ...BASE, headline: longHeadline });
    // Very wide glyphs so nothing fits.
    const { canvas, rec } = makeFakeCanvas(60);
    const res = await renderAd(plan, {}, { createCanvas: () => canvas });
    expect(res.overflow).toBe(true);
    const drawn = rec.fillTextCalls.map((c) => c.text).join(" ");
    expect(drawn).not.toContain("…");
  });

  it("draws a cover-cropped background when a bitmap is supplied", async () => {
    const plan = computeAdLayout({ ...BASE, layout: "full_bleed" });
    const { canvas, rec } = makeFakeCanvas(10);
    const fakeImg = { width: 1024, height: 1536 } as unknown as CanvasImageSource & { width: number; height: number };
    await renderAd(plan, { background: fakeImg }, { createCanvas: () => canvas });
    expect(rec.drawImageCalls.length).toBeGreaterThan(0);
    // drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) - 9 args, cover source rect
    const call = rec.drawImageCalls[0];
    expect(call.length).toBe(9);
  });
});

describe("cover/contain geometry", () => {
  it("computeCoverRect fills the destination and crops the overflow axis, centred", () => {
    // 1024x1536 (2:3) into 1080x1080 (1:1): full width kept, height cropped.
    const r = computeCoverRect(1024, 1536, 1080, 1080);
    expect(Math.round(r.sx)).toBe(0);
    expect(r.sy).toBeGreaterThan(0);
    expect(Math.round(r.sw)).toBe(1024);
    expect(r.sh).toBeLessThan(1536);
  });
  it("computeContainRect never exceeds the destination box", () => {
    const r = computeContainRect(1024, 1536, 1080, 1080);
    expect(r.dw).toBeLessThanOrEqual(1080);
    expect(r.dh).toBeLessThanOrEqual(1080);
  });
});

// Targeted verification requested after the Split overlap fix: does
// professional_card have the SAME class of collision, given its CTA pill
// is positioned at a FIXED bottom-anchored y independent of how far the
// headline/body/infoBits content cursor actually reaches? Unlike Split
// (whose CTA is also bottom-anchored but whose body has generous
// headroom below it), professional_card's card area is much shorter, so
// this is worth checking directly rather than assuming safety by
// analogy - real fillRect/fillText draw order + positions, not just the
// pure layout.ts reservation math.
type DrawEvent = { kind: "rect"; y: number; h: number } | { kind: "text"; text: string; y: number };

function makeOrderedCanvas(glyphWidth: number): { canvas: CanvasLike; events: DrawEvent[] } {
  const events: DrawEvent[] = [];
  const ctx: Ctx2DLike = {
    canvas: { width: 0, height: 0 },
    fillStyle: "",
    font: "",
    textBaseline: "",
    textAlign: "",
    fillRect: (_x, y, _w, h) => events.push({ kind: "rect", y, h }),
    fillText: (text, _x, y) => events.push({ kind: "text", text, y }),
    measureText: (text: string) => ({ width: text.length * glyphWidth }),
    drawImage: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    rect: () => {},
    clip: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }) as unknown as CanvasGradient,
  };
  const canvas: CanvasLike = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    convertToBlob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
  };
  return { canvas, events };
}

describe("professional_card - CTA collision risk (targeted verification, not assumed)", () => {
  const NORMAL_BODY = "Certified technicians you can trust.";
  const LONG_BODY =
    "Our certified technicians provide comprehensive vehicle care including diagnostics, brakes, suspension, and full-service maintenance so your family never gets stranded on the road again.";
  const LONG_HEADLINE = "Expert Care for Your Vehicle and Family Every Single Day of the Year";

  const CASES: { label: string; size: AdRenderInput["size"]; headline: string; body: string }[] = [
    { label: "normal body @ 1080x1080", size: "1080x1080", headline: "Keep Your Fleet Moving", body: NORMAL_BODY },
    { label: "long body @ 1080x1080", size: "1080x1080", headline: "Keep Your Fleet Moving", body: LONG_BODY },
    { label: "long headline + long body @ 1080x1080", size: "1080x1080", headline: LONG_HEADLINE, body: LONG_BODY },
    { label: "normal body @ 1080x1350", size: "1080x1350", headline: "Keep Your Fleet Moving", body: NORMAL_BODY },
    { label: "long body @ 1080x1350", size: "1080x1350", headline: "Keep Your Fleet Moving", body: LONG_BODY },
    { label: "long headline + long body @ 1080x1350", size: "1080x1350", headline: LONG_HEADLINE, body: LONG_BODY },
  ];

  for (const { label, size, headline, body } of CASES) {
    it(`${label}: body/infoBits text never reaches the CTA pill's top edge`, async () => {
      const plan = computeAdLayout({
        ...BASE,
        layout: "professional_card",
        size,
        headline,
        body,
        cta: "Contact Us Today", // distinctive words, won't collide with body/headline content below
        price: "From R499",
        contact: "021 555 0100",
      });
      // professional_card always pushes exactly 2 structural rects
      // (image/placeholder area, white card area) before the CTA pill's
      // own rect - a realistic glyph width (~0.5x fontSize, matching
      // this file's GLYPH_ADVANCE convention) drives real wrapping.
      const { canvas, events } = makeOrderedCanvas(0.52 * 63 /* approx professional_card headline fontSize@1080 */);
      await renderAd(plan, {}, { createCanvas: () => canvas });
      const rects = events.filter((e): e is Extract<DrawEvent, { kind: "rect" }> => e.kind === "rect");
      expect(rects.length).toBe(3);
      const ctaRectY = rects[2].y;

      const ctaWords = new Set("contact us today".split(" "));
      const nonCtaTextEvents = events.filter(
        (e): e is Extract<DrawEvent, { kind: "text" }> => e.kind === "text" && !ctaWords.has(e.text.toLowerCase()),
      );
      const maxNonCtaTextY = Math.max(...nonCtaTextEvents.map((e) => e.y));

      if (maxNonCtaTextY >= ctaRectY) {
        // Collision reproduced - fail loudly with the exact numbers so
        // this is a real, actionable regression rather than a silent
        // pass/fail.
        throw new Error(`Collision: body/infoBits text at y=${maxNonCtaTextY} reaches into the CTA pill starting at y=${ctaRectY} (case: ${label})`);
      }
      expect(maxNonCtaTextY).toBeLessThan(ctaRectY);
    });
  }
});

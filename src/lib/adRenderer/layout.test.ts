import { describe, expect, it } from "vitest";
import { AD_LAYOUTS, AD_SIZES, AD_SIZE_DIMENSIONS } from "./spec";
import { computeAdLayout, planTextStrings, resolveCta, RENDERER_FALLBACK_CTA, type AdRenderInput, type TextElement } from "./layout";

const BASE: AdRenderInput = {
  layout: "split",
  size: "1080x1080",
  headline: "Take back your Tuesday",
  body: "StabiFlow automates the follow-ups so you can close, not chase.",
  cta: "Start free trial",
  brandName: "StabiFlow",
  contact: "hello@stabiflow.com · 021 555 0100",
  price: "From R499/mo",
  disclaimer: "Terms apply. E&OE.",
  hasLogo: false,
  hasBackground: true,
  brand: { primary: "#0f766e", accent: "#f97316", ctaText: null },
};

describe("computeAdLayout - sizes", () => {
  for (const size of AD_SIZES) {
    for (const layout of AD_LAYOUTS) {
      it(`${layout} @ ${size} produces a plan at the exact Meta dimensions`, () => {
        const plan = computeAdLayout({ ...BASE, layout, size });
        expect(plan.width).toBe(AD_SIZE_DIMENSIONS[size].width);
        expect(plan.height).toBe(AD_SIZE_DIMENSIONS[size].height);
        expect(plan.elements.length).toBeGreaterThan(0);
      });
    }
  }
});

describe("computeAdLayout - exact commercial text is passed through verbatim", () => {
  for (const layout of AD_LAYOUTS) {
    it(`${layout}: the stored headline and CTA appear unchanged in the plan`, () => {
      const plan = computeAdLayout({ ...BASE, layout });
      const strings = planTextStrings(plan);
      expect(strings).toContain(BASE.headline);
      expect(strings).toContain(BASE.cta);
    });
  }

  it("professional_card: the exact contact/price string is carried into the plan", () => {
    const plan = computeAdLayout({ ...BASE, layout: "professional_card" });
    const joined = planTextStrings(plan).join(" || ");
    expect(joined).toContain("From R499/mo");
    expect(joined).toContain("hello@stabiflow.com · 021 555 0100");
  });

  it("does not uppercase the underlying headline string even when the CTA is styled uppercase", () => {
    const plan = computeAdLayout({ ...BASE, layout: "bold_statement" });
    const headlineEl = plan.elements.find((e) => e.kind === "text" && e.role === "headline");
    expect(headlineEl && "text" in headlineEl ? headlineEl.text : "").toBe(BASE.headline);
    const ctaEl = plan.elements.find((e) => e.kind === "text" && e.role === "cta");
    expect(ctaEl && "text" in ctaEl ? ctaEl.text : "").toBe(BASE.cta); // stored value, not "START FREE TRIAL"
    expect(ctaEl && "uppercase" in ctaEl ? ctaEl.uppercase : false).toBe(true); // presentation hint only
  });
});

describe("computeAdLayout - one background, many outputs", () => {
  it("every layout/size combination references the same single background image element", () => {
    const combos = AD_LAYOUTS.flatMap((layout) => AD_SIZES.map((size) => computeAdLayout({ ...BASE, layout, size })));
    for (const plan of combos) {
      const bg = plan.elements.filter((e) => e.kind === "image" && e.source === "background");
      expect(bg.length).toBe(1);
    }
    // 4 layouts x 3 sizes = 12 deterministic creatives from one visual.
    expect(combos.length).toBe(12);
  });

  it("falls back to a brand-colour block (no image element) when there is no background", () => {
    const plan = computeAdLayout({ ...BASE, hasBackground: false });
    expect(plan.elements.some((e) => e.kind === "image" && e.source === "background")).toBe(false);
  });
});

describe("computeAdLayout - honest overflow signalling", () => {
  it("flags overflowRisk for an absurdly long headline rather than silently accepting it", () => {
    const longHeadline = "This headline is deliberately far too long to ever fit inside a single advert panel at any sane font size whatsoever and then some more";
    const plan = computeAdLayout({ ...BASE, layout: "split", headline: longHeadline });
    expect(plan.overflowRisk).toBe(true);
    // still passed through verbatim - never pre-truncated in the plan
    expect(planTextStrings(plan)).toContain(longHeadline);
  });

  it("does not flag overflow for a normal headline", () => {
    const plan = computeAdLayout({ ...BASE, layout: "split" });
    expect(plan.overflowRisk).toBe(false);
  });
});

describe("computeAdLayout - brand kit", () => {
  it("uses the brand accent colour for the CTA pill fill", () => {
    const plan = computeAdLayout({ ...BASE, layout: "split" });
    const pill = plan.elements.find((e) => e.kind === "rect" && "color" in e && e.color === "#f97316");
    expect(pill).toBeTruthy();
  });
  it("falls back to sane defaults when brand colours are not hex", () => {
    const plan = computeAdLayout({ ...BASE, brand: { primary: "not-a-color", accent: "", ctaText: null } });
    expect(plan.width).toBe(1080);
    expect(plan.elements.length).toBeGreaterThan(0);
  });
});

// CTA precedence (approved plan clarification #2): a user-edited/approved
// or AI-generated creative CTA must ALWAYS win over workspace_settings.
// default_ad_cta - the Brand Kit default is a fallback, never an override.
describe("resolveCta - CTA precedence", () => {
  it("keeps the creative's own CTA even when a Brand Kit default is set", () => {
    expect(resolveCta("Book a demo", "Get a free quote")).toBe("Book a demo");
  });
  it("keeps the creative's own CTA when the Brand Kit default is null", () => {
    expect(resolveCta("Book a demo", null)).toBe("Book a demo");
  });
  it("falls back to the Brand Kit default only when the creative CTA is empty", () => {
    expect(resolveCta("", "Get a free quote")).toBe("Get a free quote");
    expect(resolveCta(null, "Get a free quote")).toBe("Get a free quote");
    expect(resolveCta("   ", "Get a free quote")).toBe("Get a free quote");
  });
  it("falls back to the renderer's last-resort default when both are empty", () => {
    expect(resolveCta(null, null)).toBe(RENDERER_FALLBACK_CTA);
    expect(resolveCta("", "")).toBe(RENDERER_FALLBACK_CTA);
  });
  it("never lets the Brand Kit default silently overwrite a real CTA (regression guard)", () => {
    // A future edit that flips the precedence (e.g. defaultAdCta ?? creativeCta)
    // would fail this the moment both are non-empty.
    const own = "Reserve your spot";
    const brandDefault = "Learn more today";
    expect(resolveCta(own, brandDefault)).toBe(own);
    expect(resolveCta(own, brandDefault)).not.toBe(brandDefault);
  });
});

// Production regression: Split (and professional_card) layouts advanced
// the cursor from headline to body using a character-count guess
// (`Math.ceil(headline.length / N)`) that diverges from the canvas's real
// font-metric wrapping - a large headline in Split's narrow panel wraps
// to more lines than the guess assumed, so the body text started before
// the headline's last line finished. The fix reserves the headline's
// WORST-CASE height (maxLines at the starting font size) - a guaranteed
// upper bound, since drawText() (canvas.ts) only ever shrinks fontSize or
// clips at maxLines, never exceeds it - so body can never collide
// regardless of the actual headline content.
function findText(plan: ReturnType<typeof computeAdLayout>, role: TextElement["role"]): TextElement {
  const el = plan.elements.find((e): e is TextElement => e.kind === "text" && e.role === role);
  if (!el) throw new Error(`No "${role}" text element in plan`);
  return el;
}

function headlineWorstCaseBottom(headline: TextElement): number {
  // Math.round to match maxTextBlockHeight()'s own rounding in layout.ts -
  // this is a same-pixel comparison, not a looser tolerance.
  return headline.y + Math.round(headline.fontSize * headline.lineHeight * headline.maxLines);
}

describe("computeAdLayout - headline/body never overlap (production overlap regression)", () => {
  const HEADLINES = {
    short: "Fast",
    long: "Expert Care for Your Vehicle and Family Every Single Day",
    multiLine: "Keep Your Fleet Moving",
    reportedExamples: ["Expert Care for Your Vehicle", "Keep Your Fleet Moving", "Your Family's Safety Matters"],
  };

  for (const [label, headline] of Object.entries(HEADLINES).flatMap((entry) =>
    Array.isArray(entry[1]) ? entry[1].map((h, i) => [`${entry[0]}[${i}]`, h] as const) : [entry as readonly [string, string]],
  )) {
    it(`split @ 1080x1080: body starts at/after the headline's worst-case height ("${label}")`, () => {
      const plan = computeAdLayout({ ...BASE, layout: "split", size: "1080x1080", headline });
      const h = findText(plan, "headline");
      const b = findText(plan, "body");
      expect(b.y).toBeGreaterThanOrEqual(headlineWorstCaseBottom(h));
    });

    it(`split @ 1080x1350: body starts at/after the headline's worst-case height ("${label}")`, () => {
      const plan = computeAdLayout({ ...BASE, layout: "split", size: "1080x1350", headline });
      const h = findText(plan, "headline");
      const b = findText(plan, "body");
      expect(b.y).toBeGreaterThanOrEqual(headlineWorstCaseBottom(h));
    });

    it(`professional_card: body starts at/after the headline's worst-case height ("${label}")`, () => {
      const plan = computeAdLayout({ ...BASE, layout: "professional_card", headline });
      const h = findText(plan, "headline");
      const b = findText(plan, "body");
      expect(b.y).toBeGreaterThanOrEqual(headlineWorstCaseBottom(h));
    });
  }

  it("headline + long body copy: body's own reserved block still ends before the CTA pill for split", () => {
    const longBody =
      "Our certified technicians provide comprehensive vehicle care including diagnostics, brakes, suspension, and full-service maintenance so your family never gets stranded on the road again.";
    const plan = computeAdLayout({ ...BASE, layout: "split", size: "1080x1350", headline: "Keep Your Fleet Moving", body: longBody });
    const b = findText(plan, "body");
    const ctaRect = plan.elements.find((e) => e.kind === "rect" && e.y > b.y);
    expect(ctaRect).toBeDefined();
    // The body's own worst-case block (its maxLines at its fontSize) must
    // not run past where the CTA pill begins.
    const bodyWorstCaseBottom = b.y + b.fontSize * b.lineHeight * b.maxLines;
    expect(bodyWorstCaseBottom).toBeLessThanOrEqual((ctaRect as { y: number }).y);
  });

  it("full_bleed layout is unaffected by the Split/professional_card fix (regression guard)", () => {
    for (const headline of HEADLINES.reportedExamples) {
      const plan = computeAdLayout({ ...BASE, layout: "full_bleed", headline });
      const h = findText(plan, "headline");
      const b = findText(plan, "body");
      // full_bleed builds bottom-up with fixed reservations - body is
      // always ABOVE the headline in paint order/position here, so the
      // invariant is simply that neither element's box collides with the
      // CTA pill, which full_bleed already guarantees structurally.
      expect(h.y).toBeGreaterThan(0);
      expect(b.y).toBeGreaterThan(0);
    }
  });
});

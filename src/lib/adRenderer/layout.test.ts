import { describe, expect, it } from "vitest";
import { AD_LAYOUTS, AD_SIZES, AD_SIZE_DIMENSIONS } from "./spec";
import { computeAdLayout, planTextStrings, type AdRenderInput } from "./layout";

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

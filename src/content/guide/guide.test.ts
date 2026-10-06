import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDE_CHAPTERS, GUIDE_PARTS, adjacentChapters, chapterPath, getChapter, highlightParts, searchGuide } from "@/content/guide";
import type { GuideBlock } from "@/content/guide/types";

const allBlocks = (): GuideBlock[] => GUIDE_CHAPTERS.flatMap((c) => c.sections.flatMap((s) => s.blocks));

describe("guide content integrity", () => {
  it("has unique chapter slugs, numbered 1..n in order", () => {
    expect(new Set(GUIDE_CHAPTERS.map((c) => c.slug)).size).toBe(GUIDE_CHAPTERS.length);
    expect(GUIDE_CHAPTERS.map((c) => c.number)).toEqual(GUIDE_CHAPTERS.map((_, i) => i + 1));
  });

  it("has unique, URL-safe section ids within each chapter", () => {
    for (const c of GUIDE_CHAPTERS) {
      const ids = c.sections.map((s) => s.id);
      expect(new Set(ids).size, c.slug).toBe(ids.length);
      for (const id of ids) expect(id, `${c.slug}#${id}`).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("only uses known parts, and every part has a chapter", () => {
    for (const c of GUIDE_CHAPTERS) expect(GUIDE_PARTS).toContain(c.part);
    for (const p of GUIDE_PARTS) expect(GUIDE_CHAPTERS.some((c) => c.part === p), p).toBe(true);
  });

  it("links only to chapters and sections that exist", () => {
    for (const c of GUIDE_CHAPTERS) {
      for (const r of c.related ?? []) expect(getChapter(r), `${c.slug} related ${r}`).toBeDefined();
      for (const s of c.sections) {
        for (const b of s.blocks) {
          if (b.type !== "workflow") continue;
          for (const stage of b.stages) {
            const target = getChapter(stage.chapter ?? (stage.section ? c.slug : undefined));
            if (!stage.chapter && !stage.section) continue;
            expect(target, `${c.slug}#${s.id} -> ${stage.chapter}`).toBeDefined();
            if (stage.section) expect(target!.sections.some((x) => x.id === stage.section), `${stage.chapter ?? c.slug}#${stage.section}`).toBe(true);
          }
        }
      }
    }
  });

  it("references only screenshots that exist in public/help/screenshots", () => {
    const missing = allBlocks()
      .filter((b): b is Extract<GuideBlock, { type: "screenshot" }> => b.type === "screenshot")
      .map((b) => b.shot.src)
      .filter((src) => !existsSync(path.resolve("public/help/screenshots", src)));
    expect(missing).toEqual([]);
  });

  it("has at least 50 FAQ questions", () => {
    const n = allBlocks().filter((b) => b.type === "faq").reduce((sum, b) => sum + (b.type === "faq" ? b.items.length : 0), 0);
    expect(n).toBeGreaterThanOrEqual(50);
  });

  it("states that StabiFlow Library templates are not automatically Meta-approved", () => {
    const text = JSON.stringify(getChapter("messages"));
    expect(text).toMatch(/NOT automatically approved by Meta/);
  });

  it("never exposes internal feature flag keys to customers", () => {
    expect(JSON.stringify(GUIDE_CHAPTERS)).not.toMatch(/module\.[a-z_]+/);
  });
});

describe("guide navigation helpers", () => {
  it("builds deep links", () => {
    expect(chapterPath("messages", "templates")).toBe("/app/guide/messages#templates");
    expect(chapterPath("leads")).toBe("/app/guide/leads");
  });

  it("finds previous and next chapters", () => {
    const { previous, next } = adjacentChapters("home");
    expect(previous?.slug).toBe("getting-started");
    expect(next?.slug).toBe("business-studio");
    expect(adjacentChapters(GUIDE_CHAPTERS[0].slug).previous).toBeUndefined();
    expect(adjacentChapters(GUIDE_CHAPTERS[GUIDE_CHAPTERS.length - 1].slug).next).toBeUndefined();
  });

  it("returns undefined for unknown chapters", () => {
    expect(getChapter("nope")).toBeUndefined();
    expect(getChapter(undefined)).toBeUndefined();
  });
});

describe("guide search", () => {
  it.each(["WhatsApp", "payment", "lead", "template", "create business profile", "automation", "billing", "Meta"])("finds results for %s", (q) => {
    expect(searchGuide(q).length).toBeGreaterThan(0);
  });

  it("ranks a section whose title matches first", () => {
    expect(searchGuide("StabiFlow Library")[0]).toMatchObject({ chapterSlug: "messages", sectionId: "library" });
    expect(searchGuide("24-hour window")[0].chapterSlug).toBe("messages");
  });

  it("requires every word to match and is case-insensitive", () => {
    expect(searchGuide("PAYSTACK").length).toBeGreaterThan(0);
    expect(searchGuide("paystack zzzxqy")).toEqual([]);
    expect(searchGuide("   ")).toEqual([]);
  });

  it("highlights matched words", () => {
    expect(highlightParts("Templates are approved", "template")).toEqual([
      { text: "Template", match: true },
      { text: "s are approved", match: false },
    ]);
    expect(highlightParts("a+b (c)", "(c")).toEqual([{ text: "a+b ", match: false }, { text: "(c", match: true }, { text: ")", match: false }]);
  });
});

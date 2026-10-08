import { admin } from "./admin";
import { analytics } from "./analytics";
import { automations } from "./automations";
import { billing } from "./billing";
import { businessStudio } from "./business-studio";
import { campaigns } from "./campaigns";
import { content } from "./content";
import { creativeStudio } from "./creative-studio";
import { customers } from "./customers";
import { documents } from "./documents";
import { faq } from "./faq";
import { flowAi } from "./flow-ai";
import { gettingStarted } from "./getting-started";
import { home } from "./home";
import { integrations } from "./integrations";
import { leads } from "./leads";
import { messages } from "./messages";
import { mobile } from "./mobile";
import { myBusiness } from "./my-business";
import { settings } from "./settings";
import { troubleshooting } from "./troubleshooting";
import { welcome } from "./welcome";
import { workflows } from "./workflows";
import type { GuideBlock, GuideChapter, GuidePart } from "./types";

export type { GuideBlock, GuideChapter, GuideSection } from "./types";

export const GUIDE_CHAPTERS: GuideChapter[] = [
  welcome, gettingStarted, home,
  businessStudio, myBusiness, documents,
  creativeStudio, content, campaigns,
  messages, leads, customers,
  automations, flowAi, analytics, integrations,
  billing, settings, mobile,
  admin, workflows, troubleshooting, faq,
];

export const GUIDE_PARTS: GuidePart[] = ["Start here", "Your business", "Marketing", "Customers", "Automate & measure", "Account", "Reference"];

const BY_SLUG = new Map(GUIDE_CHAPTERS.map((c) => [c.slug, c]));

export function getChapter(slug: string | undefined): GuideChapter | undefined {
  return slug ? BY_SLUG.get(slug) : undefined;
}

export function adjacentChapters(slug: string): { previous?: GuideChapter; next?: GuideChapter } {
  const i = GUIDE_CHAPTERS.findIndex((c) => c.slug === slug);
  return { previous: i > 0 ? GUIDE_CHAPTERS[i - 1] : undefined, next: i >= 0 ? GUIDE_CHAPTERS[i + 1] : undefined };
}

export { chapterPath } from "./paths";

/** Total sections - the unit guide progress is counted in. */
export const GUIDE_SECTION_COUNT = GUIDE_CHAPTERS.reduce((n, c) => n + c.sections.length, 0);

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export type GuideSearchEntry = {
  chapterSlug: string;
  chapterTitle: string;
  sectionId: string;
  sectionTitle: string;
  text: string;
  keywords: string;
};

export function blockText(block: GuideBlock): string[] {
  switch (block.type) {
    case "p": return [block.text];
    case "list": case "checklist": return block.items;
    case "steps": return block.steps.flatMap((s) => [s.title, s.detail ?? ""]);
    case "callout": return [block.title ?? "", block.text];
    case "screenshot": return [block.shot.alt, block.shot.caption ?? ""];
    case "faq": return block.items.flatMap((i) => [i.q, i.a]);
    case "troubleshoot": return block.items.flatMap((i) => [i.symptom, ...i.causes, ...i.check, ...i.fix, i.contactSupport ?? ""]);
    case "workflow": return block.stages.flatMap((s) => [s.label, s.detail ?? ""]);
    case "table": return [...block.head, ...block.rows.flat()];
  }
}

export const GUIDE_SEARCH_INDEX: GuideSearchEntry[] = GUIDE_CHAPTERS.flatMap((c) =>
  c.sections.map((s) => ({
    chapterSlug: c.slug,
    chapterTitle: c.title,
    sectionId: s.id,
    sectionTitle: s.title,
    text: s.blocks.flatMap(blockText).filter(Boolean).join(" "),
    keywords: [...(s.keywords ?? []), ...(c.keywords ?? []), c.description].join(" "),
  })),
);

export type GuideSearchResult = GuideSearchEntry & { score: number; snippet: string };

const normalise = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

function makeSnippet(text: string, term: string): string {
  const idx = normalise(text).indexOf(term);
  if (idx < 0) return text.slice(0, 140) + (text.length > 140 ? "…" : "");
  const start = Math.max(0, idx - 50);
  const end = Math.min(text.length, idx + term.length + 90);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/** Every word must appear somewhere in the section; titles weigh most. */
export function searchGuide(query: string, limit = 12): GuideSearchResult[] {
  const terms = normalise(query).split(/\s+/).filter((t) => t.length > 0);
  if (terms.length === 0) return [];
  const results: GuideSearchResult[] = [];
  for (const e of GUIDE_SEARCH_INDEX) {
    const title = normalise(`${e.sectionTitle} ${e.chapterTitle}`);
    const kw = normalise(e.keywords);
    const body = normalise(e.text);
    let score = 0;
    let all = true;
    for (const t of terms) {
      const inTitle = title.includes(t);
      const inKw = kw.includes(t);
      const inBody = body.includes(t);
      if (!inTitle && !inKw && !inBody) { all = false; break; }
      score += (inTitle ? 10 : 0) + (inKw ? 4 : 0) + (inBody ? 1 : 0);
    }
    if (!all) continue;
    if (normalise(e.sectionTitle).includes(terms.join(" "))) score += 15;
    results.push({ ...e, score, snippet: makeSnippet(e.text, terms[0]) });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Splits text around the query words so callers can wrap matches in <mark>. */
export function highlightParts(text: string, query: string): { text: string; match: boolean }[] {
  const terms = query.trim().split(/\s+/).filter((t) => t.length > 1).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (terms.length === 0) return [{ text, match: false }];
  // With one capture group, split() alternates plain text (even) and matches (odd).
  return text
    .split(new RegExp(`(${terms.join("|")})`, "i"))
    .map((part, i) => ({ text: part, match: i % 2 === 1 }))
    .filter((p) => p.text.length > 0);
}

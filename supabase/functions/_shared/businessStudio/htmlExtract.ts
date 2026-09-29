// Deterministic HTML -> data extraction (no DOM available in the edge
// runtime, no third-party parser). Output is plain text and plain values
// only: scripts, styles, iframes, forms and event handlers never survive,
// so nothing extracted here can execute anywhere it is later displayed.

export type ExtractedLink = { href: string; text: string };

export type ExtractedPage = {
  url: string;
  title: string | null;
  metaDescription: string | null;
  siteName: string | null;
  text: string;
  headings: string[];
  links: ExtractedLink[];
  jsonLd: Record<string, unknown>[];
  emails: string[];
  phones: string[];
  whatsapp: string[];
  social: { platform: string; url: string }[];
};

const MAX_TEXT = 20_000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"',
  hellip: "...", copy: "(c)", reg: "(R)", trade: "(TM)", eacute: "e", egrave: "e", ecirc: "e", aacute: "a", agrave: "a", ocirc: "o", uuml: "u", ouml: "o", auml: "a",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return " ";
      // Control characters never pass through.
      return code < 32 && code !== 9 && code !== 10 ? " " : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function collapse(s: string): string {
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  if (!m) return null;
  return decodeEntities(m[2] ?? m[3] ?? m[4] ?? "").trim();
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "));
}

const SOCIAL_HOSTS: [RegExp, string][] = [
  [/(^|\.)facebook\.com$|(^|\.)fb\.com$/, "facebook"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)linkedin\.com$/, "linkedin"],
  [/(^|\.)(twitter|x)\.com$/, "x"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, "youtube"],
  [/(^|\.)pinterest\.[a-z.]+$/, "pinterest"],
  [/(^|\.)g\.page$|(^|\.)business\.google\.com$/, "google_business"],
];

// Share/intent links are not the business's own profile.
const SOCIAL_NOISE = /\/(sharer|share|intent|dialog|plugins|tr\b|hashtag)\b|[?&](u|url|text)=/i;

export function socialPlatformFor(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  for (const [re, platform] of SOCIAL_HOSTS) if (re.test(host)) return SOCIAL_NOISE.test(url.pathname + url.search) || url.pathname.length <= 1 ? null : platform;
  return null;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi;
// South African and international formats: +27 11 123 4567, 011 123 4567, (011) 123-4567, 082 123 4567.
const PHONE_RE = /(?:\+?27[\s-]?|\(?0)\d{2}\)?[\s-]?\d{3}[\s-]?\d{4}\b|\+\d{1,3}[\s-]?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g;

const IGNORED_EMAIL = /\.(png|jpe?g|gif|webp|svg)$|@(example|sentry|wixpress|domain)\./i;

export function normalizePhone(raw: string): string {
  return raw.replace(/[^\d+]/g, "");
}

export function extractPage(html: string, pageUrl: string): ExtractedPage {
  const base = new URL(pageUrl);
  const src = html.length > 3_000_000 ? html.slice(0, 3_000_000) : html;

  // JSON-LD before scripts are stripped.
  const jsonLd: Record<string, unknown>[] = [];
  for (const m of src.matchAll(/<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const items = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray((parsed as { "@graph"?: unknown })["@graph"]) ? (parsed as { "@graph": unknown[] })["@graph"] : [parsed];
      for (const it of items) if (it && typeof it === "object" && !Array.isArray(it)) jsonLd.push(it as Record<string, unknown>);
    } catch {
      // malformed JSON-LD is ignored
    }
    if (jsonLd.length > 20) break;
  }

  const cleaned = src
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|object|embed|canvas|form|select|button)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(script|style|iframe|object|embed)\b[^>]*\/?>/gi, " ");

  const title = (() => {
    const m = cleaned.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return m ? collapse(stripTags(m[1])).slice(0, 300) || null : null;
  })();

  let metaDescription: string | null = null;
  let siteName: string | null = null;
  for (const m of cleaned.matchAll(/<meta\b[^>]*>/gi)) {
    const name = (attr(m[0], "name") ?? attr(m[0], "property") ?? "").toLowerCase();
    const content = attr(m[0], "content");
    if (!content) continue;
    if (!metaDescription && (name === "description" || name === "og:description")) metaDescription = collapse(content).slice(0, 600);
    if (!siteName && name === "og:site_name") siteName = collapse(content).slice(0, 200);
  }

  const links: ExtractedLink[] = [];
  const emails = new Set<string>();
  const phones = new Set<string>();
  const whatsapp = new Set<string>();
  const social = new Map<string, { platform: string; url: string }>();
  for (const m of cleaned.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(`<a ${m[1]}>`, "href");
    if (!href) continue;
    const text = collapse(stripTags(m[2])).slice(0, 200);
    if (/^mailto:/i.test(href)) {
      const e = decodeURIComponent(href.slice(7).split("?")[0]).trim().toLowerCase();
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !IGNORED_EMAIL.test(e)) emails.add(e);
      continue;
    }
    if (/^tel:/i.test(href)) {
      const p = normalizePhone(decodeURIComponent(href.slice(4)));
      if (p.replace(/\D/g, "").length >= 9) phones.add(p);
      continue;
    }
    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      continue;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    const host = u.hostname.toLowerCase();
    if (host === "wa.me" || host === "api.whatsapp.com" || host === "wa.link") {
      const num = host === "wa.me" ? u.pathname.slice(1) : u.searchParams.get("phone") ?? "";
      const digits = num.replace(/\D/g, "");
      if (digits.length >= 9) whatsapp.add(`+${digits}`);
      continue;
    }
    const platform = socialPlatformFor(u);
    if (platform) {
      u.hash = "";
      const clean = `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
      if (!social.has(clean)) social.set(clean, { platform, url: clean });
      continue;
    }
    u.hash = "";
    links.push({ href: u.toString(), text });
    if (links.length > 400) break;
  }

  const headings = [...cleaned.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => collapse(stripTags(m[1]))).filter((h) => h && h.length <= 200).slice(0, 40);

  const text = collapse(
    stripTags(
      cleaned
        .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/header|\/footer|\/address)\b[^>]*>/gi, "\n")
        .replace(/<(p|div|li|h[1-6]|tr|section|article|address)\b[^>]*>/gi, "\n"),
    ),
  ).slice(0, MAX_TEXT);

  for (const e of text.match(EMAIL_RE) ?? []) if (!IGNORED_EMAIL.test(e)) emails.add(e.toLowerCase());
  for (const p of text.match(PHONE_RE) ?? []) {
    const n = normalizePhone(p);
    if (n.replace(/\D/g, "").length >= 9 && n.replace(/\D/g, "").length <= 15) phones.add(n);
  }

  return {
    url: pageUrl, title, metaDescription, siteName, text, headings, links, jsonLd,
    emails: [...emails].slice(0, 10), phones: [...phones].slice(0, 10), whatsapp: [...whatsapp].slice(0, 5), social: [...social.values()].slice(0, 15),
  };
}

// -- robots.txt -------------------------------------------------------------------

export function parseRobots(txt: string, agent = "stabiflowbot"): string[] {
  const disallow: string[] = [];
  let applies = false;
  let sawAgentLine = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [k, ...rest] = line.split(":");
    const key = k.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      if (!sawAgentLine) applies = false;
      sawAgentLine = true;
      const ua = value.toLowerCase();
      if (ua === "*" || agent.includes(ua) || ua.includes(agent)) applies = true;
    } else {
      sawAgentLine = false;
      if (applies && key === "disallow" && value) disallow.push(value);
    }
  }
  return disallow;
}

export function isAllowedByRobots(path: string, disallow: string[]): boolean {
  return !disallow.some((rule) => {
    const anchored = rule.endsWith("$");
    const body = anchored ? rule.slice(0, -1) : rule;
    const re = new RegExp("^" + body.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""));
    return re.test(path);
  });
}

// -- Page selection -----------------------------------------------------------------

const PRIORITY = /about|who-?we-?are|company|contact|service|product|solution|what-?we-?do|team|people|leadership|project|portfolio|case-?stud|work|client|certif|accredit|award|industr/i;
const SKIP = /\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|pptx?|mp4|mp3)$|\/(wp-admin|wp-login|cart|checkout|account|login|signin|register|feed|tag|category|author)\b|[?&](replytocom|add-to-cart)=/i;

export function sameSite(a: URL, b: URL): boolean {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, "");
  return strip(a.hostname) === strip(b.hostname);
}

/** Picks up to `max` internal pages worth reading, most informative first. */
export function selectPagesToCrawl(home: URL, links: ExtractedLink[], max: number): URL[] {
  const seen = new Set<string>([`${home.origin}${home.pathname.replace(/\/+$/, "")}`]);
  const scored: { url: URL; score: number }[] = [];
  for (const l of links) {
    let u: URL;
    try {
      u = new URL(l.href);
    } catch {
      continue;
    }
    if (!sameSite(u, home) || SKIP.test(u.pathname + u.search)) continue;
    u.search = "";
    const key = `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const depth = u.pathname.split("/").filter(Boolean).length;
    const score = (PRIORITY.test(u.pathname) || PRIORITY.test(l.text) ? 10 : 0) - depth;
    scored.push({ url: u, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, max).map((s) => s.url);
}

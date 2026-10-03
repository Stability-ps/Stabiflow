// A4 company profile PDF renderer (pdf-lib, standard fonts, no network).
//
// Deterministic: the same ProfileContent + template always renders the
// same document. Text is sanitised to the WinAnsi range the standard PDF
// fonts support, wrapped by measured width, and flowed across pages with
// running headers/footers. Watermarked output (no pdf_export entitlement)
// is decided by the caller server-side, never by the browser.
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage, type RGB } from "https://esm.sh/pdf-lib@1.17.1";
import { profileSections, type ProfileContent } from "./profileContent.ts";

export type TemplateLayout = "band" | "sidebar" | "minimal";
export type RenderOptions = {
  layout: TemplateLayout;
  headingFont: "serif" | "sans";
  watermark: boolean;
  logo?: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  generatedOn?: Date;
};

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function luminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** White or near-black text, whichever reads better on the given fill. */
export function onColor(hex: string): RGB {
  return luminance(hex) > 0.45 ? rgb(0.1, 0.1, 0.12) : rgb(1, 1, 1);
}

const REPLACEMENTS: Record<string, string> = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", " ": " ", "•": "-", "™": "(TM)" };

/** Keeps only characters the standard (WinAnsi) fonts can encode. */
export function sanitize(text: string): string {
  return text
    .replace(/[‘’“”–—… •™]/g, (c) => REPLACEMENTS[c] ?? " ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e\n¡-ÿ]/g, "")
    .replace(/[ \t]+/g, " ");
}

export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of sanitize(text).split(/\n+/)) {
    const words = para.trim().split(" ").filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // A single word wider than the column is hard-split.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    if (line) lines.push(line);
  }
  return lines;
}

type Ctx = {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  x0: number;
  width: number;
  fonts: { body: PDFFont; bold: PDFFont; heading: PDFFont };
  c: ProfileContent;
  opts: RenderOptions;
  primary: RGB;
  accent: RGB;
  text: RGB;
  muted: RGB;
};

function decoratePage(ctx: Ctx, page: PDFPage, isCover: boolean) {
  const [w, h] = A4;
  const { c, opts } = ctx;
  if (opts.layout === "band" && !isCover) {
    page.drawRectangle({ x: 0, y: h - 36, width: w, height: 36, color: ctx.primary });
    page.drawText(sanitize(c.name).slice(0, 80), { x: MARGIN, y: h - 24, size: 10, font: ctx.fonts.bold, color: onColor(c.brand.primary) });
  } else if (opts.layout === "sidebar") {
    page.drawRectangle({ x: 0, y: 0, width: 18, height: h, color: ctx.primary });
    page.drawRectangle({ x: 18, y: 0, width: 4, height: h, color: ctx.accent });
  } else if (opts.layout === "minimal" && !isCover) {
    page.drawLine({ start: { x: MARGIN, y: h - 40 }, end: { x: w - MARGIN, y: h - 40 }, thickness: 0.8, color: ctx.accent });
    page.drawText(sanitize(c.name).slice(0, 80), { x: MARGIN, y: h - 34, size: 9, font: ctx.fonts.body, color: ctx.muted });
  }
}

function newPage(ctx: Ctx, isCover = false): PDFPage {
  const page = ctx.doc.addPage(A4);
  decoratePage(ctx, page, isCover);
  ctx.page = page;
  ctx.y = A4[1] - (isCover ? MARGIN : 80);
  return page;
}

function ensure(ctx: Ctx, needed: number) {
  if (ctx.y - needed < MARGIN + 30) newPage(ctx);
}

function paragraph(ctx: Ctx, text: string, size = 10.5, font?: PDFFont, color?: RGB, gapAfter = 8) {
  const f = font ?? ctx.fonts.body;
  const lh = size * 1.45;
  const paras = text.split(/\n+/).filter((p) => p.trim());
  paras.forEach((para, i) => {
    for (const line of wrapText(para, f, size, ctx.width)) {
      ensure(ctx, lh);
      ctx.page.drawText(line, { x: ctx.x0, y: ctx.y - size, size, font: f, color: color ?? ctx.text });
      ctx.y -= lh;
    }
    if (i < paras.length - 1) ctx.y -= size * 0.6;
  });
  ctx.y -= gapAfter;
}

function heading(ctx: Ctx, text: string) {
  ensure(ctx, 60);
  ctx.y -= 6;
  ctx.page.drawText(sanitize(text), { x: ctx.x0, y: ctx.y - 18, size: 18, font: ctx.fonts.heading, color: ctx.primary });
  ctx.y -= 26;
  ctx.page.drawRectangle({ x: ctx.x0, y: ctx.y, width: 36, height: 2.5, color: ctx.accent });
  ctx.y -= 16;
}

function item(ctx: Ctx, title: string, meta: string | null, body: string | null) {
  ensure(ctx, 40);
  paragraph(ctx, title, 11.5, ctx.fonts.bold, ctx.text, meta || body ? 2 : 10);
  if (meta) paragraph(ctx, meta, 9.5, ctx.fonts.body, ctx.muted, body ? 3 : 10);
  if (body) paragraph(ctx, body, 10, ctx.fonts.body, ctx.text, 12);
}

function drawCover(ctx: Ctx, logo: PDFImage | null) {
  const [w, h] = A4;
  const { c, opts } = ctx;
  const page = newPage(ctx, true);
  const onPrimary = onColor(c.brand.primary);

  if (opts.layout === "band") {
    page.drawRectangle({ x: 0, y: h * 0.45, width: w, height: h * 0.55, color: ctx.primary });
    page.drawRectangle({ x: 0, y: h * 0.45 - 6, width: w, height: 6, color: ctx.accent });
  } else if (opts.layout === "sidebar") {
    page.drawRectangle({ x: 0, y: 0, width: w * 0.36, height: h, color: ctx.primary });
  }

  const textX = opts.layout === "sidebar" ? w * 0.36 + 36 : MARGIN;
  const textW = w - textX - MARGIN;
  const nameColor = opts.layout === "band" ? onPrimary : ctx.primary;
  let y = opts.layout === "band" ? h - 170 : h * 0.62;

  if (logo) {
    const maxW = opts.layout === "sidebar" ? w * 0.36 - 60 : 160;
    const scale = Math.min(maxW / logo.width, 90 / logo.height, 1);
    const lw = logo.width * scale;
    const lh = logo.height * scale;
    const lx = opts.layout === "sidebar" ? (w * 0.36 - lw) / 2 : MARGIN;
    const ly = opts.layout === "sidebar" ? h - 140 - lh : opts.layout === "band" ? h - 70 - lh : h - 90 - lh;
    // A plate behind the logo keeps it legible on any brand colour.
    if (opts.layout !== "minimal") page.drawRectangle({ x: lx - 10, y: ly - 10, width: lw + 20, height: lh + 20, color: rgb(1, 1, 1) });
    page.drawImage(logo, { x: lx, y: ly, width: lw, height: lh });
  }

  if (opts.layout === "minimal") page.drawRectangle({ x: textX, y: y + 44, width: 56, height: 4, color: ctx.accent });
  for (const line of wrapText(c.name, ctx.fonts.heading, 34, textW).slice(0, 3)) {
    page.drawText(line, { x: textX, y, size: 34, font: ctx.fonts.heading, color: nameColor });
    y -= 40;
  }
  if (c.tagline) {
    for (const line of wrapText(c.tagline, ctx.fonts.body, 15, textW).slice(0, 3)) {
      page.drawText(line, { x: textX, y, size: 15, font: ctx.fonts.body, color: opts.layout === "band" ? onPrimary : ctx.text });
      y -= 21;
    }
  }
  y -= 10;
  page.drawText("COMPANY PROFILE", { x: textX, y, size: 10, font: ctx.fonts.bold, color: opts.layout === "band" ? onPrimary : ctx.accent });

  // The one-line summary fills the cover's open space (below the band on
  // "band", under the title otherwise).
  if (c.shortDescription) {
    let dy = opts.layout === "band" ? h * 0.45 - 50 : y - 40;
    for (const line of wrapText(c.shortDescription, ctx.fonts.body, 12, textW).slice(0, 6)) {
      page.drawText(line, { x: textX, y: dy, size: 12, font: ctx.fonts.body, color: ctx.text });
      dy -= 18;
    }
  }

  // Cover footer: key contact line.
  const contactBits = [c.website, c.contacts.find((x) => x.kind === "phone")?.value, c.contacts.find((x) => x.kind === "email")?.value].filter(Boolean) as string[];
  let fy = MARGIN + 20;
  for (const line of wrapText(contactBits.join("   |   "), ctx.fonts.body, 10, textW).reverse()) {
    page.drawText(line, { x: textX, y: fy, size: 10, font: ctx.fonts.body, color: opts.layout === "sidebar" ? ctx.text : ctx.muted });
    fy += 14;
  }
  if (c.legalName && c.legalName !== c.name) {
    page.drawText(sanitize(c.legalName).slice(0, 100), { x: textX, y: fy + 4, size: 9, font: ctx.fonts.body, color: ctx.muted });
  }
}

const CONTACT_LABELS: Record<string, string> = { email: "Email", phone: "Phone", whatsapp: "WhatsApp", fax: "Fax", other: "Contact" };
const SOCIAL_LABELS: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", x: "X", tiktok: "TikTok", youtube: "YouTube", pinterest: "Pinterest", google_business: "Google", other: "Web" };

export async function renderProfilePdf(c: ProfileContent, opts: RenderOptions): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const doc = await PDFDocument.create();
  doc.setTitle(sanitize(`${c.name} - Company Profile`));
  doc.setAuthor(sanitize(c.name));
  doc.setCreator("StabiFlow Business Studio");
  doc.setProducer("StabiFlow");
  doc.setCreationDate(opts.generatedOn ?? new Date());

  const body = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const headingFont = opts.headingFont === "serif" ? await doc.embedFont(StandardFonts.TimesRomanBold) : bold;
  let logo: PDFImage | null = null;
  if (opts.logo) {
    try {
      logo = opts.logo.type === "png" ? await doc.embedPng(opts.logo.bytes) : await doc.embedJpg(opts.logo.bytes);
    } catch {
      logo = null; // unreadable logo: render without it rather than fail
    }
  }

  const x0 = opts.layout === "sidebar" ? MARGIN + 14 : MARGIN;
  const ctx: Ctx = {
    doc, page: null as unknown as PDFPage, y: 0, x0, width: A4[0] - x0 - MARGIN,
    fonts: { body, bold, heading: headingFont }, c, opts,
    primary: hexToRgb(c.brand.primary), accent: hexToRgb(c.brand.accent), text: rgb(0.13, 0.14, 0.16), muted: rgb(0.42, 0.44, 0.48),
  };

  drawCover(ctx, logo);
  const sections = profileSections(c);
  newPage(ctx);

  // A concise contents page gives longer profiles a deliberate, premium
  // structure while still adapting to businesses with fewer sections.
  const sectionTitles = [
    sections.includes("about") ? "About us" : null,
    sections.includes("mission") ? "Mission, vision and values" : null,
    sections.includes("offerings") ? (c.offerings.every((o) => o.kind === "product") ? "Our products" : "What we do") : null,
    sections.includes("projects") ? "Selected projects" : null,
    sections.includes("team") ? "Our team" : null,
    sections.includes("credentials") ? "Credentials" : null,
    "Contact us",
  ].filter(Boolean) as string[];
  heading(ctx, "Profile overview");
  paragraph(ctx, "A snapshot of the information included in this company profile.", 11, ctx.fonts.body, ctx.muted, 16);
  sectionTitles.forEach((title, index) => item(ctx, String(index + 1).padStart(2, "0") + "   " + title, null, null));
  newPage(ctx);

  if (sections.includes("about")) {
    heading(ctx, "About us");
    if (c.shortDescription) paragraph(ctx, c.shortDescription, 12.5, ctx.fonts.bold, ctx.text, 10);
    if (c.about) paragraph(ctx, c.about);
    const facts = [c.industry ? `Industry: ${c.industry}` : null, c.foundedYear ? `Established: ${c.foundedYear}` : null].filter(Boolean).join("     ");
    if (facts) paragraph(ctx, facts, 10, ctx.fonts.body, ctx.muted, 14);
  }
  if (sections.includes("mission")) {
    if (ctx.y < A4[1] - 160) newPage(ctx);
    heading(ctx, "Mission, vision and values");
    if (c.mission) item(ctx, "Our mission", null, c.mission);
    if (c.vision) item(ctx, "Our vision", null, c.vision);
    if (c.values.length) item(ctx, "Our values", null, c.values.join("  -  "));
  }
  if (sections.includes("offerings")) {
    newPage(ctx);
    heading(ctx, c.offerings.every((o) => o.kind === "product") ? "Our products" : "What we do");
    for (const o of c.offerings) item(ctx, o.name, o.price, o.description);
  }
  if (sections.includes("projects")) {
    newPage(ctx);
    heading(ctx, "Selected projects");
    for (const p of c.projects) item(ctx, p.title, [p.client, p.location, p.year ? String(p.year) : null].filter(Boolean).join("  |  ") || null, p.description);
  }
  if (sections.includes("team")) {
    newPage(ctx);
    heading(ctx, "Our team");
    for (const t of c.team) item(ctx, t.name, t.role, t.bio);
  }
  if (sections.includes("credentials")) {
    if (ctx.y < A4[1] - 160) newPage(ctx);
    heading(ctx, "Credentials");
    for (const cert of c.certifications) item(ctx, cert.name, [cert.issuer, cert.expires ? `Valid until ${cert.expires}` : null].filter(Boolean).join("  |  ") || null, null);
    for (const idf of c.identifiers) item(ctx, idf.label, idf.value, null);
  }

  newPage(ctx);
  heading(ctx, "Contact us");
  for (const k of c.contacts) paragraph(ctx, `${k.label ?? CONTACT_LABELS[k.kind] ?? k.kind}:  ${k.value}`, 11, ctx.fonts.body, ctx.text, 4);
  if (c.website) paragraph(ctx, `Website:  ${c.website}`, 11, ctx.fonts.body, ctx.text, 4);
  if (c.locations.length) {
    ctx.y -= 6;
    for (const l of c.locations) paragraph(ctx, l, 10.5, ctx.fonts.body, ctx.text, 4);
  }
  if (c.social.length) {
    ctx.y -= 6;
    for (const s of c.social) paragraph(ctx, `${SOCIAL_LABELS[s.platform] ?? s.platform}:  ${s.url}`, 10, ctx.fonts.body, ctx.muted, 3);
  }

  // Footers + watermark on every page.
  const pages = doc.getPages();
  const total = pages.length;
  pages.forEach((p, idx) => {
    if (idx > 0) {
      p.drawText(`${idx + 1} / ${total}`, { x: A4[0] - MARGIN - 30, y: 26, size: 8.5, font: body, color: ctx.muted });
      p.drawText(sanitize(`${c.name} - Company Profile`).slice(0, 90), { x: ctx.x0, y: 26, size: 8.5, font: body, color: ctx.muted });
    }
    if (opts.watermark) {
      p.drawText("PREVIEW", { x: 120, y: 280, size: 110, font: bold, color: rgb(0.75, 0.75, 0.78), opacity: 0.28, rotate: degrees(45) });
      const note = "Preview - purchase to download the final profile without this watermark";
      p.drawText(note, { x: A4[0] - MARGIN - body.widthOfTextAtSize(note, 7.5), y: 12, size: 7.5, font: body, color: ctx.muted });
    }
  });

  const bytes = await doc.save();
  return { bytes, pageCount: total };
}

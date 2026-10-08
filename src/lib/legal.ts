// Admin-published legal documents (see 20261017060000_legal_documents_cms.sql).
import { supabase } from "@/integrations/supabase/client";

export type LegalDocumentType =
  | "privacy_policy" | "terms_of_service" | "cookie_policy" | "refund_policy" | "subscription_terms" | "ai_data_disclosure" | "data_deletion";

export const LEGAL_DOCUMENTS: { type: LegalDocumentType; slug: string; title: string; acceptanceTracked: boolean }[] = [
  { type: "privacy_policy", slug: "privacy", title: "Privacy Policy", acceptanceTracked: true },
  { type: "terms_of_service", slug: "terms", title: "Terms of Service", acceptanceTracked: true },
  { type: "subscription_terms", slug: "subscription-terms", title: "Subscription Terms", acceptanceTracked: false },
  { type: "refund_policy", slug: "refunds", title: "Refund Policy", acceptanceTracked: false },
  { type: "cookie_policy", slug: "cookies", title: "Cookie Policy", acceptanceTracked: false },
  { type: "ai_data_disclosure", slug: "ai-and-data", title: "AI and Data Use", acceptanceTracked: false },
  { type: "data_deletion", slug: "data-deletion", title: "Data Deletion", acceptanceTracked: false },
];

export type PublishedLegalDocument = { id: string; document_type: LegalDocumentType; version: string; title: string; body: string; effective_at: string; published_at: string | null };

export async function fetchPublishedLegal(type: LegalDocumentType): Promise<PublishedLegalDocument | null> {
  const { data, error } = await supabase
    .from("legal_documents")
    .select("id, document_type, version, title, body, effective_at, published_at")
    .eq("document_type", type)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PublishedLegalDocument | null) ?? null;
}

export async function fetchLegalHistory(type: LegalDocumentType) {
  const { data, error } = await supabase
    .from("legal_documents")
    .select("version, effective_at, published_at, status")
    .eq("document_type", type)
    .in("status", ["published", "superseded"])
    .order("published_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchMyLegalAcceptanceStatus(): Promise<"current" | "outdated" | "none"> {
  const { data, error } = await supabase.rpc("my_legal_acceptance_status");
  if (error) throw new Error(error.message);
  return (data as "current" | "outdated" | "none") ?? "none";
}

export async function reacceptLegal() {
  const { error } = await supabase.rpc("reaccept_current_legal_terms");
  if (error) throw new Error(error.message);
}

// -- Limited markdown -------------------------------------------------------------
// Blocks: "## " / "### " headings, "- " bullets, blank-line separated
// paragraphs. Inline: **bold**, [text](url). Anything else is plain text.

export type Inline = { kind: "text" | "bold"; text: string } | { kind: "link"; text: string; href: string };
export type Block =
  | { kind: "h2" | "h3"; inline: Inline[] }
  | { kind: "p"; inline: Inline[] }
  | { kind: "ul"; items: Inline[][] };

/** Only http(s), mailto: and site-relative links survive; everything else renders as text. */
export function safeLegalHref(href: string): string | null {
  const h = href.trim();
  if (/^\/(?!\/)[\w\-./?=&#%]*$/.test(h)) return h;
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(h)) return h;
  try {
    const u = new URL(h);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) out.push({ kind: "text", text: line.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else {
      const href = safeLegalHref(m[3]);
      out.push(href ? { kind: "link", text: m[2], href } : { kind: "text", text: m[2] });
    }
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ kind: "text", text: line.slice(last) });
  return out;
}

export function parseLegalMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: Inline[][] | null = null;
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", inline: parseInline(para.join(" ")) });
    para = [];
    if (list) blocks.push({ kind: "ul", items: list });
    list = null;
  };
  for (const raw of src.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const h = line.match(/^(#{2,3})\s+(.*)$/);
    if (h) {
      flush();
      blocks.push({ kind: h[1].length === 2 ? "h2" : "h3", inline: parseInline(h[2]) });
      continue;
    }
    const b = line.match(/^[-*]\s+(.*)$/);
    if (b) {
      if (para.length) {
        blocks.push({ kind: "p", inline: parseInline(para.join(" ")) });
        para = [];
      }
      (list ??= []).push(parseInline(b[1]));
      continue;
    }
    if (list) {
      blocks.push({ kind: "ul", items: list });
      list = null;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

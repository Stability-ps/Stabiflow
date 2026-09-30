// Business Studio client: website scan, fact proposals review, AI wording,
// preview, documents, hosted profile and website monitoring.
//
// Authorization and entitlements are enforced server-side (business-studio
// edge function, RLS, accept_business_fact_proposal); this module only
// calls them.
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Tables = Database["public"]["Tables"];
export type FactProposal = Tables["business_fact_proposals"]["Row"];
export type BusinessDocument = Tables["business_documents"]["Row"];
export type HostedProfile = Tables["hosted_profiles"]["Row"];
export type WebsiteMonitor = Tables["website_monitors"]["Row"];
export type ProfileTemplate = { key: string; name: string; description: string | null; is_premium: boolean; config: { layout?: "band" | "sidebar" | "minimal"; headingFont?: "serif" | "sans" } };

export type ProfileContent = {
  name: string;
  legalName: string | null;
  tagline: string | null;
  shortDescription: string | null;
  about: string | null;
  mission: string | null;
  vision: string | null;
  values: string[];
  industry: string | null;
  foundedYear: number | null;
  website: string | null;
  offerings: { name: string; description: string | null; price: string | null; kind: string }[];
  projects: { title: string; client: string | null; description: string | null; year: number | null; location: string | null }[];
  team: { name: string; role: string | null; bio: string | null }[];
  certifications: { name: string; issuer: string | null; expires: string | null }[];
  identifiers: { label: string; value: string }[];
  contacts: { kind: string; label: string | null; value: string }[];
  locations: string[];
  social: { platform: string; url: string }[];
  brand: { primary: string; secondary: string; accent: string; hasLogo: boolean };
};

async function readErrorPayloadFromContext(error: unknown): Promise<unknown> {
  const context = (error as { context?: unknown } | null)?.context;
  if (!context || typeof context !== "object") return null;
  const res = context as { json?: () => Promise<unknown>; clone?: () => unknown };
  const source = typeof res.clone === "function" ? (res.clone() as typeof res) : res;
  if (typeof source.json === "function") {
    try {
      return await source.json();
    } catch {
      return null;
    }
  }
  return null;
}

export class BusinessStudioError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("business-studio", { body });
  if (error) {
    const payload = ((await readErrorPayloadFromContext(error)) ?? data) as { error?: string; code?: string } | null;
    throw new BusinessStudioError(payload?.error || error.message || "Request failed", payload?.code);
  }
  if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) {
    throw new BusinessStudioError((data as { error: string }).error, (data as { code?: string }).code);
  }
  return data as T;
}

export type ScanResult = {
  scanId: string;
  finalUrl: string | null;
  pagesFetched: number;
  proposalsCreated: number;
  summary: { name: string | null; description: string | null; website: string | null };
};

export const scanWebsite = (workspaceId: string, url: string) => invoke<ScanResult>({ action: "scan", workspace_id: workspaceId, url });
export const extractFromText = (workspaceId: string, text: string) => invoke<{ proposalsCreated: number }>({ action: "extract_text", workspace_id: workspaceId, text });
export const improveWording = (workspaceId: string, tone: string) => invoke<{ suggestions: number; rejected: string[] }>({ action: "improve_wording", workspace_id: workspaceId, tone });
export const fetchPreview = (workspaceId: string) =>
  invoke<{ content: ProfileContent; templates: ProfileTemplate[]; canExportPdf: boolean; canUsePremium: boolean }>({ action: "preview", workspace_id: workspaceId });
export const generateDocument = (workspaceId: string, templateKey: string, title?: string) =>
  invoke<{ document: Pick<BusinessDocument, "id" | "title" | "template_key" | "watermarked" | "page_count" | "created_at">; url: string | null }>({
    action: "generate_document", workspace_id: workspaceId, template_key: templateKey, title,
  });

export async function fetchPendingProposals(workspaceId: string): Promise<FactProposal[]> {
  const { data, error } = await supabase
    .from("business_fact_proposals")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function acceptProposal(id: string, edited?: Record<string, unknown> | null) {
  const { data, error } = await supabase.rpc("accept_business_fact_proposal", { p_proposal_id: id, p_edited: (edited ?? null) as never });
  if (error) throw new Error(error.message);
  return data;
}

export async function rejectProposal(id: string) {
  const { data, error } = await supabase.rpc("reject_business_fact_proposal", { p_proposal_id: id });
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchDocuments(workspaceId: string): Promise<BusinessDocument[]> {
  const { data, error } = await supabase.from("business_documents").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function documentDownloadUrl(doc: Pick<BusinessDocument, "storage_path" | "title">): Promise<string> {
  if (!doc.storage_path) throw new Error("This document has no file");
  const { data, error } = await supabase.storage.from("business-documents").createSignedUrl(doc.storage_path, 120, { download: `${doc.title.replace(/[^\w\- ]+/g, "")}.pdf` });
  if (error || !data) throw new Error(error?.message ?? "Could not create download link");
  return data.signedUrl;
}

export async function fetchHostedProfile(workspaceId: string): Promise<HostedProfile | null> {
  const { data, error } = await supabase.from("hosted_profiles").select("*").eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function saveHostedProfile(workspaceId: string, patch: Partial<Pick<HostedProfile, "slug" | "is_published" | "template_key" | "document_id" | "show_enquiry">>, exists: boolean) {
  const q = exists
    ? supabase.from("hosted_profiles").update(patch).eq("workspace_id", workspaceId)
    : supabase.from("hosted_profiles").insert({ workspace_id: workspaceId, slug: patch.slug ?? "", ...patch });
  const { data, error } = await q.select("*").single();
  if (error) throw new Error(error.message.includes("hosted_profiles_slug_key") ? "That link is already taken - try another" : error.message);
  return data;
}

export async function isSlugAvailable(slug: string): Promise<boolean> {
  const { data } = await supabase.rpc("is_hosted_profile_slug_available", { p_slug: slug });
  return data === true;
}

export async function fetchMonitor(workspaceId: string): Promise<WebsiteMonitor | null> {
  const { data, error } = await supabase.from("website_monitors").select("*").eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function saveMonitor(workspaceId: string, patch: { url: string; enabled: boolean; frequency_days: number }, exists: boolean) {
  const q = exists
    ? supabase.from("website_monitors").update(patch).eq("workspace_id", workspaceId)
    : supabase.from("website_monitors").insert({ workspace_id: workspaceId, ...patch });
  const { error } = await q;
  if (error) throw new Error(error.message);
}

/** Suggests a hosted-profile link from the business name ("Acme (Pty) Ltd" -> "acme"). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\((pty)\)|\bltd\b|\bcc\b|\binc\b|\bllc\b/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

export const PUBLIC_PROFILE_PATH = (slug: string) => `/b/${slug}`;

export type PublicProfileResponse = {
  profile: {
    slug: string;
    template_key: string;
    show_enquiry: boolean;
    has_document: boolean;
    identity: {
      name: string | null; legal_name: string | null; tagline: string | null; short_description: string | null; long_description: string | null;
      mission: string | null; vision: string | null; core_values: string[] | null; industry: string | null; website: string | null; founded_year: number | null;
    };
    brand: { primary: string | null; secondary: string | null; accent: string | null; has_logo: boolean } | null;
    contacts: { kind: string; label: string | null; value: string }[];
    locations: { label: string | null; address_line1: string | null; address_line2: string | null; city: string | null; region: string | null; postal_code: string | null }[];
    social_links: { platform: string; url: string }[];
    offerings: { kind: string; name: string; description: string | null; price_text: string | null }[];
    team: { full_name: string; role_title: string | null; bio: string | null }[];
    projects: { title: string; client_name: string | null; description: string | null; location: string | null; completed_year: number | null }[];
    certifications: { name: string; issuer: string | null; expires_on: string | null }[];
    identifiers: { scheme: string; country_code: string; value: string }[];
  };
  logoUrl: string | null;
  documentUrl: string | null;
};

export async function fetchPublicProfile(slug: string): Promise<PublicProfileResponse | null> {
  const base = import.meta.env.VITE_SUPABASE_URL as string;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const res = await fetch(`${base}/functions/v1/business-profile-public?slug=${encodeURIComponent(slug)}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Could not load this profile");
  return (await res.json()) as PublicProfileResponse;
}

/** Only http(s) links from profile data are ever rendered as links. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function whatsappHref(number: string, text?: string): string | null {
  const digits = number.replace(/\D/g, "");
  const intl = digits.startsWith("0") ? `27${digits.slice(1)}` : digits;
  if (intl.length < 9 || intl.length > 15) return null;
  return `https://wa.me/${intl}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

export const PROPOSAL_TARGET_LABELS: Record<string, string> = {
  identity_field: "Business detail",
  contact: "Contact",
  location: "Location",
  social_link: "Social media",
  offering: "Service / product",
  team_member: "Team member",
  project: "Project",
  certification: "Certification",
  identifier: "Registration number",
};

export const IDENTITY_FIELD_LABELS: Record<string, string> = {
  legal_name: "Registered name",
  trading_name: "Business name",
  industry: "Industry",
  website: "Website",
  tagline: "Tagline",
  short_description: "Short description",
  long_description: "About the business",
  mission: "Mission",
  vision: "Vision",
  founded_year: "Year founded",
  core_values: "Core values",
};

/** One human-readable line for a proposal's value. */
export function describeProposal(p: Pick<FactProposal, "target" | "field" | "proposed">): string {
  const v = (p.proposed ?? {}) as Record<string, unknown>;
  const t = (x: unknown) => (x === null || x === undefined ? "" : Array.isArray(x) ? x.join(", ") : String(x));
  switch (p.target) {
    case "identity_field":
      return t(v.value);
    case "contact":
      return `${t(v.kind)}: ${t(v.value)}`;
    case "location":
      return [v.address_line1, v.city, v.region, v.postal_code].map(t).filter(Boolean).join(", ");
    case "social_link":
      return `${t(v.platform)}: ${t(v.url)}`;
    case "offering":
      return [t(v.name), t(v.description)].filter(Boolean).join(" - ");
    case "team_member":
      return [t(v.full_name), t(v.role_title)].filter(Boolean).join(", ");
    case "project":
      return [t(v.title), v.client_name ? `for ${t(v.client_name)}` : ""].filter(Boolean).join(" ");
    case "certification":
      return [t(v.name), t(v.issuer)].filter(Boolean).join(" - ");
    case "identifier":
      return `${t(v.scheme).replace(/_/g, " ")}: ${t(v.value)}`;
    default:
      return JSON.stringify(v);
  }
}

/** Readable text colour on a brand fill (same rule as the PDF renderer). */
export function textOn(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.45 ? "#1a1a1f" : "#ffffff";
}

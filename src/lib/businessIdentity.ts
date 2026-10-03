// Business Identity data access + pure helpers (completeness, provenance
// labels). The canonical model and its guards live in
// supabase/migrations/20261011060000_business_identity.sql - RLS decides
// who can read/write; nothing here is an authorization check.
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Tables = Database["public"]["Tables"];

export type BusinessIdentity = Tables["business_identities"]["Row"];
export type BusinessIdentityUpdate = Tables["business_identities"]["Update"];

export const BUSINESS_CHILD_TABLES = [
  "business_contacts",
  "business_locations",
  "business_social_links",
  "business_offerings",
  "business_team_members",
  "business_projects",
  "business_certifications",
  "business_identifiers",
] as const;
export type BusinessChildTable = (typeof BUSINESS_CHILD_TABLES)[number];

export type BusinessContact = Tables["business_contacts"]["Row"];
export type BusinessLocation = Tables["business_locations"]["Row"];
export type BusinessSocialLink = Tables["business_social_links"]["Row"];
export type BusinessOffering = Tables["business_offerings"]["Row"];
export type BusinessTeamMember = Tables["business_team_members"]["Row"];
export type BusinessProject = Tables["business_projects"]["Row"];
export type BusinessCertification = Tables["business_certifications"]["Row"];
export type BusinessIdentifier = Tables["business_identifiers"]["Row"];

export type BusinessIdentityBundle = {
  identity: BusinessIdentity;
  contacts: BusinessContact[];
  locations: BusinessLocation[];
  socialLinks: BusinessSocialLink[];
  offerings: BusinessOffering[];
  team: BusinessTeamMember[];
  projects: BusinessProject[];
  certifications: BusinessCertification[];
  identifiers: BusinessIdentifier[];
  sectionPreferences: { section: string; status: string; reason: string | null }[];
};

export type FactSource = "user" | "website_scan" | "document_upload" | "ai_suggestion" | "backfill" | "operator" | "import";
export type VerificationStatus = "unverified" | "user_confirmed" | "verified" | "rejected";

export const SOURCE_LABELS: Record<FactSource, string> = {
  user: "Entered by you",
  website_scan: "Found on your website",
  document_upload: "From an uploaded document",
  ai_suggestion: "AI suggestion",
  backfill: "From your earlier settings",
  operator: "Added by StabiFlow support",
  import: "Imported",
};

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  unverified: "Not yet confirmed",
  user_confirmed: "Confirmed by you",
  verified: "Verified by StabiFlow",
  rejected: "Rejected",
};

export const COUNTRY_IDENTIFIER_SCHEMES: Record<string, { scheme: string; label: string }[]> = {
  ZA: [
    { scheme: "za_cipc_registration", label: "CIPC registration number" },
    { scheme: "za_vat", label: "VAT number" },
    { scheme: "za_tax_reference", label: "Income tax reference" },
    { scheme: "za_bbbee_level", label: "B-BBEE level" },
    { scheme: "za_csd_supplier", label: "CSD supplier number" },
    { scheme: "za_cidb_grading", label: "CIDB grading" },
  ],
};

export function identifierSchemeLabel(countryCode: string, scheme: string): string {
  return COUNTRY_IDENTIFIER_SCHEMES[countryCode]?.find((s) => s.scheme === scheme)?.label ?? scheme.replace(/_/g, " ");
}

export async function fetchBusinessIdentity(workspaceId: string): Promise<BusinessIdentityBundle> {
  const [identity, contacts, locations, socialLinks, offerings, team, projects, certifications, identifiers, sectionPreferences] = await Promise.all([
    supabase.from("business_identities").select("*").eq("workspace_id", workspaceId).single(),
    supabase.from("business_contacts").select("*").eq("workspace_id", workspaceId).order("sort_order"),
    supabase.from("business_locations").select("*").eq("workspace_id", workspaceId).order("sort_order"),
    supabase.from("business_social_links").select("*").eq("workspace_id", workspaceId).order("sort_order"),
    supabase.from("business_offerings").select("*").eq("workspace_id", workspaceId).order("sort_order"),
    supabase.from("business_team_members").select("*").eq("workspace_id", workspaceId).order("sort_order"),
    supabase.from("business_projects").select("*").eq("workspace_id", workspaceId).order("sort_order"),
    supabase.from("business_certifications").select("*").eq("workspace_id", workspaceId).order("sort_order"),
    supabase.from("business_identifiers").select("*").eq("workspace_id", workspaceId).order("created_at"),
    supabase.from("business_profile_section_preferences").select("section,status,reason").eq("workspace_id", workspaceId),
  ]);
  const firstError = [identity, contacts, locations, socialLinks, offerings, team, projects, certifications, identifiers, sectionPreferences].find((r) => r.error)?.error;
  if (firstError) throw new Error(firstError.message);

  return {
    identity: identity.data as BusinessIdentity,
    contacts: (contacts.data ?? []) as BusinessContact[],
    locations: (locations.data ?? []) as BusinessLocation[],
    socialLinks: (socialLinks.data ?? []) as BusinessSocialLink[],
    offerings: (offerings.data ?? []) as BusinessOffering[],
    team: (team.data ?? []) as BusinessTeamMember[],
    projects: (projects.data ?? []) as BusinessProject[],
    certifications: (certifications.data ?? []) as BusinessCertification[],
    identifiers: (identifiers.data ?? []) as BusinessIdentifier[],
    sectionPreferences: (sectionPreferences.data ?? []) as { section: string; status: string; reason: string | null }[],
  };
}

/**
 * Updates identity fields and records per-field provenance ("user" edit)
 * for exactly the fields that changed. field_provenance is merged, never
 * replaced, so provenance of untouched fields survives.
 */
export async function updateBusinessIdentity(current: BusinessIdentity, patch: BusinessIdentityUpdate): Promise<BusinessIdentity> {
  const changed = Object.keys(patch).filter(
    (k) => k !== "field_provenance" && JSON.stringify((patch as Record<string, unknown>)[k]) !== JSON.stringify((current as Record<string, unknown>)[k]),
  );
  if (changed.length === 0) return current;
  const now = new Date().toISOString();
  const provenance = { ...((current.field_provenance as Record<string, unknown>) ?? {}) };
  for (const k of changed) provenance[k] = { source: "user", updated_at: now };

  const update: BusinessIdentityUpdate = { field_provenance: provenance as never };
  for (const k of changed) (update as Record<string, unknown>)[k] = (patch as Record<string, unknown>)[k];

  const { data, error } = await supabase.from("business_identities").update(update).eq("id", current.id).select("*").single();
  if (error) throw new Error(error.message);
  return data as BusinessIdentity;
}

export async function insertBusinessChild(table: BusinessChildTable, row: Record<string, unknown>) {
  const { data, error } = await supabase.from(table).insert(row as never).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateBusinessChild(table: BusinessChildTable, id: string, patch: Record<string, unknown>) {
  const { data, error } = await supabase.from(table).update(patch as never).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteBusinessChild(table: BusinessChildTable, id: string) {
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Marks a fact as confirmed by the customer (never 'verified' - that is platform-only). */
export async function confirmBusinessChild(table: BusinessChildTable, id: string, userId: string) {
  return updateBusinessChild(table, id, { verification_status: "user_confirmed", confirmed_by: userId, confirmed_at: new Date().toISOString() });
}

// -- Completeness -----------------------------------------------------------------

export type CompletenessItem = { key: string; label: string; done: boolean; weight: number; section: string };

/**
 * Deterministic profile completeness. Drives the "fill the gaps" review in
 * Business Studio and the My Business progress bar. Weights reflect what a
 * professional company profile genuinely needs (identity + contact +
 * offer) over nice-to-haves (team, projects, certifications).
 */
export function computeCompleteness(b: BusinessIdentityBundle): { score: number; items: CompletenessItem[] } {
  const i = b.identity;
  const has = (v: unknown) => (typeof v === "string" ? v.trim().length > 0 : v !== null && v !== undefined);
  const notApplicable = (section: string) => b.sectionPreferences.some((p) => p.section === section && p.status === "not_applicable");
  const items: CompletenessItem[] = [
    { key: "name", label: "Business name", done: has(i.trading_name) || has(i.legal_name), weight: 10, section: "company" },
    { key: "legal_name", label: "Registered (legal) name", done: has(i.legal_name), weight: 4, section: "company" },
    { key: "industry", label: "Industry", done: has(i.industry), weight: 4, section: "company" },
    { key: "website", label: "Website", done: has(i.website), weight: 4, section: "company" },
    { key: "short_description", label: "Short description", done: has(i.short_description), weight: 10, section: "about" },
    { key: "long_description", label: "About the business", done: has(i.long_description), weight: 8, section: "about" },
    { key: "mission", label: "Mission or vision", done: has(i.mission) || has(i.vision), weight: 4, section: "about" },
    { key: "values", label: "Core values", done: (i.core_values ?? []).length > 0, weight: 3, section: "about" },
    { key: "contact", label: "Email or phone", done: b.contacts.some((c) => c.kind === "email" || c.kind === "phone"), weight: 10, section: "contacts" },
    { key: "location", label: "Location", done: b.locations.length > 0 || notApplicable("location"), weight: 6, section: "locations" },
    { key: "offerings", label: "At least 3 services or products", done: b.offerings.length >= 3, weight: 12, section: "offerings" },
    { key: "branding", label: "Logo and brand colours", done: !!i.brand_profile_id, weight: 8, section: "branding" },
    { key: "social", label: "Social media links", done: b.socialLinks.length > 0 || notApplicable("social"), weight: 3, section: "social" },
    { key: "team", label: "Team members", done: b.team.length > 0 || notApplicable("team"), weight: 4, section: "team" },
    { key: "projects", label: "Projects or case studies", done: b.projects.length > 0 || notApplicable("projects"), weight: 4, section: "projects" },
    { key: "credentials", label: "Certifications or registration", done: b.certifications.length > 0 || b.identifiers.length > 0 || notApplicable("credentials"), weight: 6, section: "credentials" },
  ];
  const total = items.reduce((s, it) => s + it.weight, 0);
  const done = items.reduce((s, it) => s + (it.done ? it.weight : 0), 0);
  return { score: Math.round((done / total) * 100), items };
}

export async function setBusinessSectionPreference(workspaceId: string, section: string, status: "applicable" | "not_applicable", userId: string | null) {
  const { error } = await supabase.from("business_profile_section_preferences").upsert({ workspace_id: workspaceId, section, status, updated_by: userId, updated_at: new Date().toISOString() } as never, { onConflict: "workspace_id,section" });
  if (error) throw new Error(error.message);
}

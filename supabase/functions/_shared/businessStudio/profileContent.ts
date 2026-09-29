// Builds the content of a company profile document from the Business
// Identity. The single source for BOTH the browser live preview and the
// PDF, so what the customer previews is what gets rendered. Only public,
// non-rejected facts are included; nothing is generated here.

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

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const visible = (r: Row) => r.is_public !== false && r.verification_status !== "rejected";

const SCHEME_LABELS: Record<string, string> = {
  za_cipc_registration: "Company registration",
  za_vat: "VAT number",
  za_tax_reference: "Tax reference",
  za_bbbee_level: "B-BBEE level",
  za_csd_supplier: "CSD supplier number",
  za_cidb_grading: "CIDB grading",
};

const HEX = /^#[0-9a-f]{6}$/i;

export function buildProfileContent(input: {
  identity: Row;
  contacts: Row[];
  locations: Row[];
  socialLinks: Row[];
  offerings: Row[];
  team: Row[];
  projects: Row[];
  certifications: Row[];
  identifiers: Row[];
  brand: Row | null;
  hasLogo: boolean;
  overrides?: Partial<Pick<ProfileContent, "tagline" | "shortDescription" | "about" | "mission" | "vision">>;
}): ProfileContent {
  const i = input.identity;
  const b = input.brand ?? {};
  const color = (v: unknown, fallback: string) => (typeof v === "string" && HEX.test(v) ? v : fallback);
  return {
    name: s(i.trading_name) ?? s(i.legal_name) ?? "Your business",
    legalName: s(i.legal_name),
    tagline: input.overrides?.tagline ?? s(i.tagline),
    shortDescription: input.overrides?.shortDescription ?? s(i.short_description),
    about: input.overrides?.about ?? s(i.long_description),
    mission: input.overrides?.mission ?? s(i.mission),
    vision: input.overrides?.vision ?? s(i.vision),
    values: Array.isArray(i.core_values) ? (i.core_values as unknown[]).map(s).filter((v): v is string => !!v) : [],
    industry: s(i.industry),
    foundedYear: typeof i.founded_year === "number" ? i.founded_year : null,
    website: s(i.website),
    offerings: input.offerings
      .filter((r) => r.verification_status !== "rejected")
      .sort((a, b2) => Number(!!b2.is_featured) - Number(!!a.is_featured))
      .map((r) => ({ name: s(r.name)!, description: s(r.description), price: s(r.price_text), kind: s(r.kind) ?? "service" }))
      .filter((r) => r.name),
    projects: input.projects.filter(visible).map((r) => ({
      title: s(r.title)!, client: s(r.client_name), description: s(r.description), year: typeof r.completed_year === "number" ? r.completed_year : null, location: s(r.location),
    })).filter((r) => r.title),
    team: input.team.filter(visible).map((r) => ({ name: s(r.full_name)!, role: s(r.role_title), bio: s(r.bio) })).filter((r) => r.name),
    certifications: input.certifications.filter(visible).map((r) => ({ name: s(r.name)!, issuer: s(r.issuer), expires: s(r.expires_on) })).filter((r) => r.name),
    identifiers: input.identifiers.filter((r) => r.is_public === true && r.verification_status !== "rejected")
      .map((r) => ({ label: SCHEME_LABELS[String(r.scheme)] ?? String(r.scheme).replace(/_/g, " "), value: String(r.value) })),
    contacts: input.contacts.filter(visible).sort((a, b2) => Number(!!b2.is_primary) - Number(!!a.is_primary))
      .map((r) => ({ kind: String(r.kind), label: s(r.label), value: String(r.value) })),
    locations: input.locations.filter(visible).sort((a, b2) => Number(!!b2.is_primary) - Number(!!a.is_primary))
      .map((r) => `${s(r.label) ? `${s(r.label)}: ` : ""}${[s(r.address_line1), s(r.address_line2), s(r.city), s(r.region), s(r.postal_code)].filter(Boolean).join(", ")}`),
    social: input.socialLinks.filter((r) => r.verification_status !== "rejected").map((r) => ({ platform: String(r.platform), url: String(r.url) })),
    brand: {
      primary: color(b.primary_color, "#1F3A5F"),
      secondary: color(b.secondary_color, "#F4F6F8"),
      accent: color(b.accent_color, "#E0A526"),
      hasLogo: input.hasLogo,
    },
  };
}

/** Sections that actually have content, in document order (empty ones are omitted, never padded). */
export function profileSections(c: ProfileContent): string[] {
  const out = ["cover"];
  if (c.about || c.shortDescription) out.push("about");
  if (c.mission || c.vision || c.values.length) out.push("mission");
  if (c.offerings.length) out.push("offerings");
  if (c.projects.length) out.push("projects");
  if (c.team.length) out.push("team");
  if (c.certifications.length || c.identifiers.length) out.push("credentials");
  out.push("contact");
  return out;
}

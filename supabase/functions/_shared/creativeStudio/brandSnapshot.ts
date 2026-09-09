// Creative Studio: resolves the brand fields a batch is generated with,
// captured ONCE at concept-generation time and stored as
// creative_studio_batches.brand_snapshot. The renderer (creative-studio-
// render, plan action) reads the snapshot back rather than re-resolving
// it live, so a brand profile edited (or deleted) after generation can
// never repaint history (instruction #7).
//
// Two sources, in priority order:
//   1. An explicit creative_brand_profiles row (brand_profile_id given).
//   2. The legacy workspace_settings brand-kit columns (no profile
//      selected, or a workspace that has never created one) - this is
//      the compatibility fallback (instruction #6), never written to by
//      the new profile editor.
// Either way the RESULT SHAPE is identical, so the render endpoint and
// the client never need to know which source produced it.
export type BrandSnapshot = {
  name: string;
  logoMediaAssetId: string | null;
  // Legacy-only: a workspace-assets storage path (pre-profile Brand Kit
  // logo). Never set when logoMediaAssetId is set.
  logoPath: string | null;
  primary: string | null;
  secondary: string | null;
  accent: string | null;
  ctaText: string | null;
  contactPhone: string | null;
  whatsapp: string | null;
  contactEmail: string | null;
  website: string | null;
  address: string | null;
  defaultCta: string | null;
  footerDisclaimer: string | null;
};

type SupabaseLike = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        eq: (col: string, val: unknown) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> };
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
};

export async function resolveBrandSnapshot(
  callerSb: SupabaseLike,
  workspaceId: string,
  brandProfileId: string | null,
): Promise<{ snapshot: BrandSnapshot; resolvedProfileId: string | null } | { error: string }> {
  if (brandProfileId) {
    const { data: profile, error } = await callerSb
      .from("creative_brand_profiles")
      .select(
        "id, workspace_id, company_name, logo_media_asset_id, primary_color, secondary_color, accent_color, cta_text_color, contact_phone, whatsapp_number, contact_email, website, address, default_cta, footer_disclaimer",
      )
      .eq("id", brandProfileId)
      .maybeSingle();
    if (error) return { error: "Could not load the selected brand profile." };
    const row = profile as
      | {
          id: string;
          workspace_id: string;
          company_name: string;
          logo_media_asset_id: string | null;
          primary_color: string | null;
          secondary_color: string | null;
          accent_color: string | null;
          cta_text_color: string | null;
          contact_phone: string | null;
          whatsapp_number: string | null;
          contact_email: string | null;
          website: string | null;
          address: string | null;
          default_cta: string | null;
          footer_disclaimer: string | null;
        }
      | null;
    if (!row || row.workspace_id !== workspaceId) {
      return { error: "brand_profile_id not found in this workspace" };
    }
    return {
      resolvedProfileId: row.id,
      snapshot: {
        name: row.company_name,
        logoMediaAssetId: row.logo_media_asset_id,
        logoPath: null,
        primary: row.primary_color,
        secondary: row.secondary_color,
        accent: row.accent_color,
        ctaText: row.cta_text_color,
        contactPhone: row.contact_phone,
        whatsapp: row.whatsapp_number,
        contactEmail: row.contact_email,
        website: row.website,
        address: row.address,
        defaultCta: row.default_cta,
        footerDisclaimer: row.footer_disclaimer,
      },
    };
  }

  // Legacy fallback: no profile selected - use workspace_settings + the
  // workspace's own name, exactly as creative-studio-render did before
  // Brand Profiles existed.
  const [{ data: ws }, { data: settings }] = await Promise.all([
    callerSb.from("workspaces").select("name").eq("id", workspaceId).maybeSingle(),
    callerSb
      .from("workspace_settings")
      .select(
        "logo_path, brand_primary_color, secondary_brand_color, brand_accent_color, brand_cta_text_color, ad_footer_disclaimer, default_ad_cta, contact_email, contact_phone, website",
      )
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
  ]);
  const wsRow = ws as { name: string } | null;
  const settingsRow = settings as
    | {
        logo_path: string | null;
        brand_primary_color: string | null;
        secondary_brand_color: string | null;
        brand_accent_color: string | null;
        brand_cta_text_color: string | null;
        ad_footer_disclaimer: string | null;
        default_ad_cta: string | null;
        contact_email: string | null;
        contact_phone: string | null;
        website: string | null;
      }
    | null;
  return {
    resolvedProfileId: null,
    snapshot: {
      name: wsRow?.name ?? "",
      logoMediaAssetId: null,
      logoPath: settingsRow?.logo_path ?? null,
      primary: settingsRow?.brand_primary_color ?? null,
      secondary: settingsRow?.secondary_brand_color ?? null,
      accent: settingsRow?.brand_accent_color ?? null,
      ctaText: settingsRow?.brand_cta_text_color ?? null,
      contactPhone: settingsRow?.contact_phone ?? null,
      whatsapp: null,
      contactEmail: settingsRow?.contact_email ?? null,
      website: settingsRow?.website ?? null,
      address: null,
      defaultCta: settingsRow?.default_ad_cta ?? null,
      footerDisclaimer: settingsRow?.ad_footer_disclaimer ?? null,
    },
  };
}

// The default contact-field display order/set when a batch does not
// specify one (instruction #16 - phone/WhatsApp primary, website
// secondary, email/address optional-only).
export const DEFAULT_CONTACT_FIELDS = ["phone", "whatsapp", "website"] as const;
export type ContactField = "phone" | "whatsapp" | "website" | "email" | "address";
const VALID_CONTACT_FIELDS = new Set<ContactField>(["phone", "whatsapp", "website", "email", "address"]);

export function parseContactFields(v: unknown): ContactField[] {
  if (!Array.isArray(v)) return [...DEFAULT_CONTACT_FIELDS];
  const filtered = v.filter((x): x is ContactField => typeof x === "string" && VALID_CONTACT_FIELDS.has(x as ContactField));
  return filtered.length > 0 ? filtered : [...DEFAULT_CONTACT_FIELDS];
}

// Builds the single "info bits" contact line the renderer draws, in a
// fixed, deterministic field order, using only the fields the caller
// selected. Company name/logo are handled separately by the renderer
// (always shown) - this is only the phone/whatsapp/website/email/address
// line (instruction #16).
export function buildContactLine(snapshot: BrandSnapshot, fields: ContactField[]): string | null {
  const parts: string[] = [];
  for (const f of fields) {
    if (f === "phone" && snapshot.contactPhone) parts.push(snapshot.contactPhone);
    else if (f === "whatsapp" && snapshot.whatsapp) parts.push(`WhatsApp ${snapshot.whatsapp}`);
    else if (f === "website" && snapshot.website) parts.push(snapshot.website);
    else if (f === "email" && snapshot.contactEmail) parts.push(snapshot.contactEmail);
    else if (f === "address" && snapshot.address) parts.push(snapshot.address);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

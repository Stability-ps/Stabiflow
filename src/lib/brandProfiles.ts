import { supabase } from "@/integrations/supabase/client";

// Creative Studio Brand Profiles - reusable named brand/company setups
// (instruction #3). RLS-gated direct table access, matching the same
// lightweight-mutation pattern Creative Studio already uses for concept
// visual-source switching and creative approve/reject (see
// BatchAdStudio.tsx) - no dedicated edge function needed for plain CRUD.
export type BrandProfile = {
  id: string;
  workspaceId: string;
  name: string;
  companyName: string;
  logoMediaAssetId: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  ctaTextColor: string | null;
  contactPhone: string | null;
  whatsappNumber: string | null;
  contactEmail: string | null;
  website: string | null;
  address: string | null;
  defaultCta: string | null;
  footerDisclaimer: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BrandProfileInput = {
  name: string;
  companyName: string;
  logoMediaAssetId?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  ctaTextColor?: string | null;
  contactPhone?: string | null;
  whatsappNumber?: string | null;
  contactEmail?: string | null;
  website?: string | null;
  address?: string | null;
  defaultCta?: string | null;
  footerDisclaimer?: string | null;
  isDefault?: boolean;
};

type BrandProfileRow = {
  id: string;
  workspace_id: string;
  name: string;
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
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

function fromRow(row: BrandProfileRow): BrandProfile {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    companyName: row.company_name,
    logoMediaAssetId: row.logo_media_asset_id,
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    accentColor: row.accent_color,
    ctaTextColor: row.cta_text_color,
    contactPhone: row.contact_phone,
    whatsappNumber: row.whatsapp_number,
    contactEmail: row.contact_email,
    website: row.website,
    address: row.address,
    defaultCta: row.default_cta,
    footerDisclaimer: row.footer_disclaimer,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type BrandProfileWriteFields = {
  name: string;
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
  is_default?: boolean;
};

function toRow(input: BrandProfileInput): BrandProfileWriteFields {
  return {
    name: input.name.trim(),
    company_name: input.companyName.trim(),
    logo_media_asset_id: input.logoMediaAssetId ?? null,
    primary_color: input.primaryColor ?? null,
    secondary_color: input.secondaryColor ?? null,
    accent_color: input.accentColor ?? null,
    cta_text_color: input.ctaTextColor ?? null,
    contact_phone: input.contactPhone?.trim() || null,
    whatsapp_number: input.whatsappNumber?.trim() || null,
    contact_email: input.contactEmail?.trim() || null,
    website: input.website?.trim() || null,
    address: input.address?.trim() || null,
    default_cta: input.defaultCta?.trim() || null,
    footer_disclaimer: input.footerDisclaimer?.trim() || null,
    ...(input.isDefault !== undefined ? { is_default: input.isDefault } : {}),
  };
}

export async function listBrandProfiles(workspaceId: string): Promise<BrandProfile[]> {
  const { data, error } = await supabase
    .from("creative_brand_profiles")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as BrandProfileRow[]).map(fromRow);
}

export async function createBrandProfile(workspaceId: string, input: BrandProfileInput): Promise<BrandProfile> {
  // The one-default-per-workspace uniqueness is DB-enforced (partial
  // unique index) - if this profile is being marked default, clear any
  // existing default first so the insert never races the constraint.
  if (input.isDefault) await clearExistingDefault(workspaceId);
  const { data, error } = await supabase
    .from("creative_brand_profiles")
    .insert({ workspace_id: workspaceId, ...toRow(input) })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create brand profile");
  return fromRow(data as BrandProfileRow);
}

export async function updateBrandProfile(id: string, workspaceId: string, input: Partial<BrandProfileInput>): Promise<BrandProfile> {
  if (input.isDefault) await clearExistingDefault(workspaceId);
  // Only send fields the caller actually supplied (partial update).
  const patch: Partial<BrandProfileWriteFields> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.companyName !== undefined) patch.company_name = input.companyName.trim();
  if (input.logoMediaAssetId !== undefined) patch.logo_media_asset_id = input.logoMediaAssetId;
  if (input.primaryColor !== undefined) patch.primary_color = input.primaryColor;
  if (input.secondaryColor !== undefined) patch.secondary_color = input.secondaryColor;
  if (input.accentColor !== undefined) patch.accent_color = input.accentColor;
  if (input.ctaTextColor !== undefined) patch.cta_text_color = input.ctaTextColor;
  if (input.contactPhone !== undefined) patch.contact_phone = input.contactPhone?.trim() || null;
  if (input.whatsappNumber !== undefined) patch.whatsapp_number = input.whatsappNumber?.trim() || null;
  if (input.contactEmail !== undefined) patch.contact_email = input.contactEmail?.trim() || null;
  if (input.website !== undefined) patch.website = input.website?.trim() || null;
  if (input.address !== undefined) patch.address = input.address?.trim() || null;
  if (input.defaultCta !== undefined) patch.default_cta = input.defaultCta?.trim() || null;
  if (input.footerDisclaimer !== undefined) patch.footer_disclaimer = input.footerDisclaimer?.trim() || null;
  if (input.isDefault !== undefined) patch.is_default = input.isDefault;
  const { data, error } = await supabase.from("creative_brand_profiles").update(patch).eq("id", id).select("*").single();
  if (error || !data) throw new Error(error?.message ?? "Could not update brand profile");
  return fromRow(data as BrandProfileRow);
}

async function clearExistingDefault(workspaceId: string): Promise<void> {
  await supabase.from("creative_brand_profiles").update({ is_default: false }).eq("workspace_id", workspaceId).eq("is_default", true);
}

export async function deleteBrandProfile(id: string): Promise<void> {
  const { error } = await supabase.from("creative_brand_profiles").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// Compatibility seed (instruction #6): if a workspace has never created
// an explicit Brand Profile but its legacy workspace_settings Brand Kit
// has meaningful values, materialize ONE default profile from them so
// the user never has to re-enter branding they already set up. Returns
// null (no profile created) when there is genuinely nothing to seed from
// - an empty profile would just be clutter for a brand-new workspace.
export async function seedDefaultProfileIfMissing(
  workspaceId: string,
  workspaceName: string,
): Promise<BrandProfile | null> {
  const existing = await listBrandProfiles(workspaceId);
  if (existing.length > 0) return null;

  const { data: settings } = await supabase
    .from("workspace_settings")
    .select("logo_path, brand_primary_color, secondary_brand_color, brand_accent_color, brand_cta_text_color, ad_footer_disclaimer, default_ad_cta, contact_email, contact_phone, website")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!settings) return null;

  const hasAnyBranding =
    !!settings.brand_primary_color ||
    !!settings.brand_accent_color ||
    !!settings.logo_path ||
    !!settings.default_ad_cta ||
    !!settings.contact_phone ||
    !!settings.contact_email ||
    !!settings.website;
  if (!hasAnyBranding) return null;

  return createBrandProfile(workspaceId, {
    name: workspaceName || "Default brand",
    companyName: workspaceName || "Default brand",
    // Legacy logo lives in the workspace-assets bucket by path, not as a
    // content_media_assets row - it is intentionally NOT copied into
    // logoMediaAssetId here (that would duplicate storage). The renderer
    // still falls back to the legacy workspace_settings.logo_path for any
    // batch with no explicit profile logo, so nothing is lost visually;
    // the user can attach a proper Media Library logo to this seeded
    // profile whenever they like.
    primaryColor: settings.brand_primary_color,
    secondaryColor: settings.secondary_brand_color,
    accentColor: settings.brand_accent_color,
    ctaTextColor: settings.brand_cta_text_color,
    contactPhone: settings.contact_phone,
    contactEmail: settings.contact_email,
    website: settings.website,
    defaultCta: settings.default_ad_cta,
    footerDisclaimer: settings.ad_footer_disclaimer,
    isDefault: true,
  });
}

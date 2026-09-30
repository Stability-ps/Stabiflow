// Loads everything a profile document / preview / public page needs for a
// workspace (service-role client; callers authorise first).
import type { AnySupabaseClient } from "../contentAuth.ts";
import { buildProfileContent, type ProfileContent } from "./profileContent.ts";

export const CONTENT_MEDIA_BUCKET = "content-media";

export async function loadProfileContent(
  sb: AnySupabaseClient,
  workspaceId: string,
): Promise<{ content: ProfileContent; logoPath: string | null }> {
  const [identity, contacts, locations, social, offerings, team, projects, certs, identifiers] = await Promise.all([
    sb.from("business_identities").select("*").eq("workspace_id", workspaceId).single(),
    sb.from("business_contacts").select("*").eq("workspace_id", workspaceId).order("sort_order"),
    sb.from("business_locations").select("*").eq("workspace_id", workspaceId).order("sort_order"),
    sb.from("business_social_links").select("*").eq("workspace_id", workspaceId).order("sort_order"),
    sb.from("business_offerings").select("*").eq("workspace_id", workspaceId).order("sort_order"),
    sb.from("business_team_members").select("*").eq("workspace_id", workspaceId).order("sort_order"),
    sb.from("business_projects").select("*").eq("workspace_id", workspaceId).order("sort_order"),
    sb.from("business_certifications").select("*").eq("workspace_id", workspaceId).order("sort_order"),
    sb.from("business_identifiers").select("*").eq("workspace_id", workspaceId),
  ]);
  if (identity.error) throw new Error(`identity: ${identity.error.message}`);

  let brand: Record<string, unknown> | null = null;
  let logoPath: string | null = null;
  if (identity.data.brand_profile_id) {
    const { data: bp } = await sb.from("creative_brand_profiles").select("*").eq("id", identity.data.brand_profile_id).eq("workspace_id", workspaceId).maybeSingle();
    brand = bp ?? null;
    if (bp?.logo_media_asset_id) {
      const { data: asset } = await sb.from("content_media_assets").select("storage_path").eq("id", bp.logo_media_asset_id).eq("workspace_id", workspaceId).maybeSingle();
      logoPath = asset?.storage_path ?? null;
    }
  }

  return {
    content: buildProfileContent({
      identity: identity.data,
      contacts: contacts.data ?? [],
      locations: locations.data ?? [],
      socialLinks: social.data ?? [],
      offerings: offerings.data ?? [],
      team: team.data ?? [],
      projects: projects.data ?? [],
      certifications: certs.data ?? [],
      identifiers: identifiers.data ?? [],
      brand,
      hasLogo: !!logoPath,
    }),
    logoPath,
  };
}

/** Downloads the logo for embedding; PNG/JPEG only, capped at 5 MB. */
export async function loadLogo(sb: AnySupabaseClient, path: string | null): Promise<{ bytes: Uint8Array; type: "png" | "jpg" } | null> {
  if (!path) return null;
  const { data, error } = await sb.storage.from(CONTENT_MEDIA_BUCKET).download(path);
  if (error || !data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.byteLength > 5_000_000) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { bytes, type: "png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { bytes, type: "jpg" };
  return null;
}

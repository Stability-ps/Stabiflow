import { supabase } from "@/integrations/supabase/client";

export const WORKSPACE_ASSETS_BUCKET = "workspace-assets";
const LOGO_SIGNED_URL_SECONDS = 300;
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const ALLOWED_LOGO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/svg+xml", "image/webp"]);

export async function isWorkspaceSlugAvailable(slug: string, excludeWorkspaceId?: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_workspace_slug_available", { p_slug: slug, p_exclude_workspace_id: excludeWorkspaceId ?? undefined });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function updateWorkspaceIdentity(workspaceId: string, input: { name: string; slug: string }) {
  const { error } = await supabase.from("workspaces").update({ name: input.name, slug: input.slug }).eq("id", workspaceId);
  if (error) {
    if (error.code === "23505") throw new Error("That URL/slug is already in use by another workspace.");
    throw new Error(error.message);
  }
}

export type WorkspaceProfileUpdate = {
  timezone?: string;
  business_description?: string | null;
  website?: string | null;
  currency?: string;
  industry?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
};

export async function updateWorkspaceProfile(workspaceId: string, input: WorkspaceProfileUpdate) {
  const { error } = await supabase.from("workspace_settings").update(input).eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
}

export async function uploadWorkspaceLogo(workspaceId: string, file: File): Promise<string> {
  if (!ALLOWED_LOGO_MIME_TYPES.has(file.type)) {
    throw new Error(`Unsupported file type: ${file.type || "unknown"}. Upload a JPEG, PNG, WebP, or SVG image.`);
  }
  if (file.size > MAX_LOGO_BYTES) {
    throw new Error(`Logo is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Maximum is ${MAX_LOGO_BYTES / (1024 * 1024)}MB.`);
  }
  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `${workspaceId}/logo-${Date.now()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from(WORKSPACE_ASSETS_BUCKET).upload(path, file, { contentType: file.type });
  if (uploadError) throw new Error(uploadError.message);

  const { data: current } = await supabase.from("workspace_settings").select("logo_path").eq("workspace_id", workspaceId).maybeSingle();
  const { error: updateError } = await supabase.from("workspace_settings").update({ logo_path: path }).eq("workspace_id", workspaceId);
  if (updateError) throw new Error(updateError.message);

  // Best-effort cleanup of the previous logo - not awaited-critical if it
  // fails (an orphaned object costs storage, not correctness or security).
  if (current?.logo_path) {
    await supabase.storage.from(WORKSPACE_ASSETS_BUCKET).remove([current.logo_path]).catch(() => {});
  }
  return path;
}

export async function getWorkspaceLogoUrl(logoPath: string | null): Promise<string | null> {
  if (!logoPath) return null;
  const { data, error } = await supabase.storage.from(WORKSPACE_ASSETS_BUCKET).createSignedUrl(logoPath, LOGO_SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

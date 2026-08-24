import { supabase } from "@/integrations/supabase/client";

export const MAX_MEDIA_ASSET_BYTES = 15 * 1024 * 1024;
export const CONTENT_MEDIA_BUCKET = "content-media";
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

function sanitizeFileName(fileName: string) {
  return fileName.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]/g, "");
}

export function assertValidMediaAssetFile(file: File) {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new Error(`Unsupported file type: ${file.type || "unknown"}. Upload a JPEG or PNG image.`);
  }
  if (file.size > MAX_MEDIA_ASSET_BYTES) {
    throw new Error(`File is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Maximum is ${MAX_MEDIA_ASSET_BYTES / (1024 * 1024)}MB.`);
  }
}

async function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dimensions;
}

export async function computeSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Duplicate-upload protection (Phase 5 requirement): checked BEFORE
// uploading any bytes, so a byte-identical re-upload never creates a
// second row or a second storage object - the caller can offer "use the
// existing asset" instead. Scoped to `status = 'active'` only: an
// archived asset with the same checksum doesn't count as "already have
// this", since the user archived it for a reason.
export async function findDuplicateMediaAsset(workspaceId: string, checksumSha256: string) {
  const { data, error } = await supabase
    .from("content_media_assets")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("checksum_sha256", checksumSha256)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export type UploadContentAssetInput = {
  workspaceId: string;
  file: File;
  title: string;
  defaultCaption?: string | null;
  createdBy: string;
  /** Skip the duplicate check and upload anyway (user explicitly chose "Upload anyway"). */
  allowDuplicate?: boolean;
};

export type UploadContentAssetResult =
  | { kind: "duplicate"; existing: Record<string, unknown> }
  | { kind: "uploaded"; asset: Record<string, unknown> };

export async function uploadContentMediaAsset(input: UploadContentAssetInput): Promise<UploadContentAssetResult> {
  assertValidMediaAssetFile(input.file);

  const [{ width, height }, checksum] = await Promise.all([readImageDimensions(input.file), computeSha256(input.file)]);

  if (!input.allowDuplicate) {
    const existing = await findDuplicateMediaAsset(input.workspaceId, checksum);
    if (existing) return { kind: "duplicate", existing };
  }

  const aspectRatio = Number((width / height).toFixed(3));
  const safeFileName = sanitizeFileName(input.file.name);
  // workspace_id MUST be the first path segment - the content-media
  // storage bucket's RLS policies parse it out of the object path to
  // decide membership/permission (see the storage migration).
  const filePath = `${input.workspaceId}/${Date.now()}-${safeFileName}`;

  const { error: uploadError } = await supabase.storage.from(CONTENT_MEDIA_BUCKET).upload(filePath, input.file, {
    upsert: false,
    contentType: input.file.type || undefined,
  });
  if (uploadError) throw new Error(uploadError.message);

  const { data: assetRow, error: insertError } = await supabase
    .from("content_media_assets")
    .insert({
      workspace_id: input.workspaceId,
      title: input.title,
      default_caption: input.defaultCaption?.trim() || null,
      storage_path: filePath,
      mime_type: input.file.type,
      width_px: width,
      height_px: height,
      aspect_ratio: aspectRatio,
      file_size_bytes: input.file.size,
      checksum_sha256: checksum,
      created_by: input.createdBy,
    })
    .select("*")
    .single();

  if (insertError) {
    await supabase.storage.from(CONTENT_MEDIA_BUCKET).remove([filePath]);
    throw new Error(insertError.message);
  }

  await supabase.from("workspace_activity_log").insert({
    workspace_id: input.workspaceId,
    actor_user_id: input.createdBy,
    action: "content_media_uploaded",
    target_type: "content_media_asset",
    target_id: assetRow.id,
    metadata: { title: input.title, mime_type: input.file.type, width_px: width, height_px: height },
  });

  return { kind: "uploaded", asset: assetRow };
}

export async function getContentAssetPreviewUrl(storagePath: string, expiresInSeconds = 300) {
  const { data, error } = await supabase.storage.from(CONTENT_MEDIA_BUCKET).createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

// Soft-delete/quarantine, never a hard DELETE from a UI action - "delete"
// in the Media Library archives the row (status='archived') so it drops
// out of active listings and duplicate-detection without destroying user
// media. A real DELETE remains possible at the DB layer (gated by
// media.delete) for deliberate cleanup, but nothing in the UI calls it.
export async function archiveContentMediaAsset(assetId: string) {
  const { error } = await supabase.from("content_media_assets").update({ status: "archived" }).eq("id", assetId);
  if (error) throw new Error(error.message);
}

export async function restoreContentMediaAsset(assetId: string) {
  const { error } = await supabase.from("content_media_assets").update({ status: "active" }).eq("id", assetId);
  if (error) throw new Error(error.message);
}

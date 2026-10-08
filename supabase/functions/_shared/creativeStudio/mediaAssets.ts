// Shared helpers for turning generated PNG bytes (an AI background or a
// rendered advert) into an ordinary content_media_assets row + object in
// the private `content-media` bucket. Reused by both creative-studio-
// visuals and creative-studio-render so generated imagery flows through
// the exact same storage / RLS / signed-URL path as user uploads - the
// Media Library and the campaign creative picker then work unchanged.

import { CONTENT_MEDIA_BUCKET } from "../contentPublishExecution.ts";
import type { AnySupabaseClient } from "../contentAuth.ts";

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Minimal PNG IHDR reader: width/height are big-endian uint32 at bytes
// 16-24. Returns null for anything that is not a PNG we can measure.
export function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIG[i]) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

export type RegisterAssetInput = {
  workspaceId: string;
  bytes: Uint8Array;
  storagePath: string; // MUST start with `${workspaceId}/` - bucket RLS parses it
  title: string;
  createdBy: string | null;
  mimeType?: string;
  width?: number;
  height?: number;
  defaultCaption?: string | null;
};

export type RegisteredAsset = {
  id: string;
  storage_path: string;
  width_px: number;
  height_px: number;
  mime_type: string;
  file_size_bytes: number;
};

export async function registerContentMediaAsset(
  sb: AnySupabaseClient,
  input: RegisterAssetInput,
): Promise<RegisteredAsset> {
  if (!input.storagePath.startsWith(`${input.workspaceId}/`)) {
    throw new Error("storagePath must be workspace-prefixed");
  }
  const mimeType = input.mimeType ?? "image/png";
  const dims =
    input.width && input.height
      ? { width: input.width, height: input.height }
      : readPngDimensions(input.bytes);
  if (!dims) throw new Error("Could not determine image dimensions");
  const checksum = await sha256Hex(input.bytes);

  const { error: uploadError } = await sb.storage
    .from(CONTENT_MEDIA_BUCKET)
    .upload(input.storagePath, input.bytes, { upsert: false, contentType: mimeType });
  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

  const { data, error } = await sb
    .from("content_media_assets")
    .insert({
      workspace_id: input.workspaceId,
      title: input.title.slice(0, 200),
      default_caption: input.defaultCaption?.trim() || null,
      storage_path: input.storagePath,
      mime_type: mimeType,
      width_px: dims.width,
      height_px: dims.height,
      aspect_ratio: Number((dims.width / dims.height).toFixed(3)),
      file_size_bytes: input.bytes.byteLength,
      checksum_sha256: checksum,
      created_by: input.createdBy,
    })
    .select("id, storage_path, width_px, height_px, mime_type, file_size_bytes")
    .single();

  if (error || !data) {
    await sb.storage.from(CONTENT_MEDIA_BUCKET).remove([input.storagePath]);
    throw new Error(`content_media_assets insert failed: ${error?.message ?? "unknown"}`);
  }
  return data as RegisteredAsset;
}

// feature label for ai_usage_events - the ONE new value this feature
// adds to the existing free-text ledger (instruction #20). Never a new
// billing table.
export const AD_CREATIVE_USAGE_FEATURE = "ad_creative_generation";

export async function recordAdCreativeUsage(
  serviceClient: AnySupabaseClient,
  event: {
    workspaceId: string;
    userId: string | null;
    model: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    status: "success" | "error";
  },
): Promise<void> {
  const { error } = await serviceClient.from("ai_usage_events").insert({
    workspace_id: event.workspaceId,
    conversation_id: null,
    user_id: event.userId,
    feature: AD_CREATIVE_USAGE_FEATURE,
    provider: "openai",
    model: event.model,
    input_tokens: Math.max(0, Math.round(event.inputTokens)),
    output_tokens: Math.max(0, Math.round(event.outputTokens)),
    // No pricing table entry for image models -> estimated_cost stays
    // null rather than a fabricated number (instruction #20).
    estimated_cost: null,
    latency_ms: event.latencyMs,
    status: event.status,
  });
  if (error) console.error("creative-studio: failed to record ad_creative_generation usage", error.message);
}

// Platform-variant generation, extracted so it can be unit tested against a
// fake store instead of a live Supabase project. The historical bug this
// guards against (from Acapolite): a single-asset "Generate platform
// versions" click regenerating variants for OTHER assets too. The fix is
// structural, not just a request-shape check - generateVariantsForAsset
// takes exactly one assetId and every dependency call it makes is scoped to
// that id, so there is no code path left that could touch a second asset's
// rows or storage objects.
//
// Adapted from Acapolite's _shared/socialVariantGeneration.ts: the variant
// storage path now starts with the asset's workspace_id (required by the
// content-media bucket's path-based RLS - see the storage migration),
// where Acapolite used the uploader's user id.
import { platformKeyForContentPlatform, validateAssetForPlatform } from "./contentPlatformRules.ts";
import { chooseInstagramFeedTarget, computeContainLayout, FACEBOOK_FALLBACK_TARGET, needsManualAdjustment } from "./contentImageTransform.ts";
import { generateContainVariant, sha256Hex } from "./contentImageProcessor.ts";

export const VARIANT_PLATFORMS = ["facebook", "instagram"] as const;

export type MediaAssetRecord = {
  id: string;
  workspace_id: string;
  storage_path: string;
  mime_type: string;
  width_px: number;
  height_px: number;
  file_size_bytes: number;
};

export type ExistingVariantRecord = { id: string; storage_path: string };

export type UpsertedVariantRecord = { id: string; storage_path: string; width_px: number; height_px: number };

export type VariantResult = {
  media_asset_id: string;
  platform: string;
  status: "already_valid" | "generated" | "needs_manual_adjustment" | "error";
  message?: string;
  variant_id?: string;
  storage_path?: string;
  width?: number;
  height?: number;
  fill_ratio?: number;
};

// Dependency-injected so the real edge function can wrap the live Supabase
// client while tests wrap an in-memory fake - every method here is already
// scoped to a single asset id, never a list.
export type GenerateVariantsDeps = {
  getAsset(assetId: string): Promise<MediaAssetRecord | null>;
  getExistingVariant(assetId: string, platform: string): Promise<ExistingVariantRecord | null>;
  downloadOriginal(storagePath: string): Promise<Uint8Array | null>;
  uploadVariant(path: string, bytes: Uint8Array, contentType: string): Promise<{ error: string | null }>;
  upsertVariant(row: {
    media_asset_id: string;
    workspace_id: string;
    platform: string;
    storage_path: string;
    width_px: number;
    height_px: number;
    aspect_ratio: number;
    mime_type: string;
    file_size_bytes: number;
    transformation_metadata: Record<string, unknown>;
  }): Promise<UpsertedVariantRecord | { error: string }>;
  removeObjects(paths: string[]): Promise<void>;
  logActivity(action: string, targetId: string, metadata: Record<string, unknown>): Promise<void>;
};

export async function generateVariantsForAsset(deps: GenerateVariantsDeps, assetId: string): Promise<VariantResult[]> {
  const results: VariantResult[] = [];
  const asset = await deps.getAsset(assetId);
  if (!asset) {
    results.push({ media_asset_id: assetId, platform: "*", status: "error", message: "Asset not found" });
    return results;
  }

  for (const platform of VARIANT_PLATFORMS) {
    const platformKey = platformKeyForContentPlatform(platform);
    const original = { mimeType: asset.mime_type, width: asset.width_px, height: asset.height_px, fileSizeBytes: asset.file_size_bytes };
    const originalValidation = validateAssetForPlatform(original, platformKey);
    if (originalValidation.valid) {
      results.push({ media_asset_id: assetId, platform, status: "already_valid" });
      continue;
    }

    const target = platform === "instagram" ? chooseInstagramFeedTarget(asset.width_px, asset.height_px) : FACEBOOK_FALLBACK_TARGET;
    const layout = computeContainLayout(asset.width_px, asset.height_px, target);
    if (needsManualAdjustment(layout)) {
      results.push({
        media_asset_id: assetId,
        platform,
        status: "needs_manual_adjustment",
        fill_ratio: layout.fillRatio,
        message: "Automatic conversion would pad away more than half the frame - adjust the source image manually.",
      });
      continue;
    }

    const existingVariant = await deps.getExistingVariant(asset.id, platform);
    const sourceBytes = await deps.downloadOriginal(asset.storage_path);
    if (!sourceBytes) {
      results.push({ media_asset_id: assetId, platform, status: "error", message: "Unable to download the original asset" });
      continue;
    }

    let generated;
    try {
      generated = await generateContainVariant(sourceBytes, asset.mime_type, target);
    } catch (error) {
      results.push({ media_asset_id: assetId, platform, status: "error", message: error instanceof Error ? error.message : "Image transform failed" });
      continue;
    }

    // Defense in depth: the variant was generated specifically to pass this
    // platform's rules, but re-validate before persisting it.
    const variantValidation = validateAssetForPlatform(
      { mimeType: generated.mimeType, width: generated.width, height: generated.height, fileSizeBytes: generated.bytes.byteLength },
      platformKey,
    );
    if (!variantValidation.valid) {
      results.push({ media_asset_id: assetId, platform, status: "error", message: `Generated variant still fails validation: ${variantValidation.failures.map((f) => f.message).join(" ")}` });
      continue;
    }

    const ext = generated.mimeType === "image/png" ? "png" : "jpg";
    const variantPath = `${asset.workspace_id}/variants/${asset.id}-${platform}-${Date.now()}.${ext}`;
    const { error: uploadError } = await deps.uploadVariant(variantPath, generated.bytes, generated.mimeType);
    if (uploadError) {
      results.push({ media_asset_id: assetId, platform, status: "error", message: uploadError });
      continue;
    }

    const checksum = await sha256Hex(generated.bytes);
    const aspectRatio = Number((generated.width / generated.height).toFixed(3));

    const upserted = await deps.upsertVariant({
      media_asset_id: asset.id,
      workspace_id: asset.workspace_id,
      platform,
      storage_path: variantPath,
      width_px: generated.width,
      height_px: generated.height,
      aspect_ratio: aspectRatio,
      mime_type: generated.mimeType,
      file_size_bytes: generated.bytes.byteLength,
      transformation_metadata: { ...generated.transformationMetadata, checksum_sha256: checksum },
    });

    if ("error" in upserted) {
      await deps.removeObjects([variantPath]);
      results.push({ media_asset_id: assetId, platform, status: "error", message: upserted.error });
      continue;
    }

    // Clean up the previous variant's storage object now that the new one
    // is safely persisted, so regeneration doesn't leak files. Scoped to
    // this asset+platform's own prior path only.
    if (existingVariant && existingVariant.storage_path !== variantPath) {
      await deps.removeObjects([existingVariant.storage_path]);
    }

    await deps.logActivity("content_platform_variant_generated", asset.id, { platform, width: generated.width, height: generated.height, regenerated: Boolean(existingVariant) });

    results.push({
      media_asset_id: assetId,
      platform,
      status: "generated",
      variant_id: upserted.id,
      storage_path: upserted.storage_path,
      width: upserted.width_px,
      height: upserted.height_px,
      fill_ratio: layout.fillRatio,
    });
  }

  return results;
}

export type ParsedGenerateVariantsRequest = { assetIds: string[]; bulk: boolean };
export type ParseGenerateVariantsError = { error: string };

// The actual regression guard: a request naming more than one asset is
// rejected unless it explicitly opts into bulk mode. The single-asset
// button in the UI sends media_asset_id (singular) and can never trigger
// this path; only a deliberate bulk action can.
export function parseGenerateVariantsRequest(body: unknown): ParsedGenerateVariantsRequest | ParseGenerateVariantsError {
  if (!body || typeof body !== "object") return { error: "Invalid request body" };
  const b = body as { media_asset_id?: unknown; media_asset_ids?: unknown; bulk?: unknown };
  const bulk = b.bulk === true;

  if (typeof b.media_asset_id === "string" && b.media_asset_id.length > 0) {
    if (b.media_asset_ids !== undefined) return { error: "Provide either media_asset_id or media_asset_ids, not both" };
    return { assetIds: [b.media_asset_id], bulk: false };
  }

  if (Array.isArray(b.media_asset_ids)) {
    const ids = b.media_asset_ids.filter((x): x is string => typeof x === "string" && x.length > 0);
    if (!ids.length) return { error: "media_asset_ids must contain at least one asset id" };
    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length > 1 && !bulk) {
      return { error: "Regenerating more than one asset requires bulk: true. Use media_asset_id to regenerate a single asset." };
    }
    return { assetIds: uniqueIds, bulk };
  }

  return { error: "media_asset_id or media_asset_ids is required" };
}

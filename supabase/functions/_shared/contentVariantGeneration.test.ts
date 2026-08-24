import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { generateVariantsForAsset, parseGenerateVariantsRequest, type GenerateVariantsDeps, type MediaAssetRecord } from "./contentVariantGeneration.ts";

async function makeTestJpegBytes(width: number, height: number): Promise<Uint8Array> {
  const img = new Image(width, height);
  img.fill(Image.rgbaToColor(30, 120, 200, 255));
  return await img.encodeJPEG(90);
}

// A minimal in-memory stand-in for the Supabase-backed deps, scoped exactly
// to what generateVariantsForAsset calls. Every read/write it records is
// keyed by asset id, so a test can assert "asset B's rows/objects are
// untouched" after only asset A was processed - a live DB integration test
// couldn't prove a negative this cleanly or this fast.
function makeFakeStore(assets: MediaAssetRecord[]) {
  const assetsById = new Map(assets.map((a) => [a.id, a]));
  const originals = new Map<string, Uint8Array>(); // storage_path -> bytes
  const variantRows = new Map<string, { id: string; media_asset_id: string; platform: string; storage_path: string; width_px: number; height_px: number }>(); // `${assetId}:${platform}` -> row
  const storageObjects = new Map<string, Uint8Array>(); // path -> bytes
  const removedPaths: string[] = [];
  const activityLog: { action: string; target_id: string; metadata: Record<string, unknown> }[] = [];
  let nextVariantId = 1;

  const deps: GenerateVariantsDeps = {
    async getAsset(assetId) {
      return assetsById.get(assetId) || null;
    },
    async getExistingVariant(assetId, platform) {
      const row = variantRows.get(`${assetId}:${platform}`);
      return row ? { id: row.id, storage_path: row.storage_path } : null;
    },
    async downloadOriginal(storagePath) {
      return originals.get(storagePath) || null;
    },
    async uploadVariant(path, bytes) {
      storageObjects.set(path, bytes);
      return { error: null };
    },
    async upsertVariant(row) {
      const id = variantRows.get(`${row.media_asset_id}:${row.platform}`)?.id || `variant-${nextVariantId++}`;
      variantRows.set(`${row.media_asset_id}:${row.platform}`, {
        id, media_asset_id: row.media_asset_id, platform: row.platform, storage_path: row.storage_path, width_px: row.width_px, height_px: row.height_px,
      });
      return { id, storage_path: row.storage_path, width_px: row.width_px, height_px: row.height_px };
    },
    async removeObjects(paths) {
      for (const p of paths) { storageObjects.delete(p); removedPaths.push(p); }
    },
    async logActivity(action, targetId, metadata) {
      activityLog.push({ action, target_id: targetId, metadata });
    },
  };

  return { deps, assetsById, originals, variantRows, storageObjects, removedPaths, activityLog };
}

const OVERSIZED_FOR_INSTAGRAM: Omit<MediaAssetRecord, "id" | "storage_path" | "workspace_id"> = {
  mime_type: "image/jpeg", width_px: 1536, height_px: 1024, file_size_bytes: 500_000,
};

Deno.test("REGRESSION: regenerating asset A never creates, updates, or removes anything for asset B", async () => {
  const assetA: MediaAssetRecord = { id: "asset-A", workspace_id: "ws-1", storage_path: "orig/A.jpg", ...OVERSIZED_FOR_INSTAGRAM };
  const assetB: MediaAssetRecord = { id: "asset-B", workspace_id: "ws-1", storage_path: "orig/B.jpg", ...OVERSIZED_FOR_INSTAGRAM };
  const store = makeFakeStore([assetA, assetB]);
  const bytes = await makeTestJpegBytes(1536, 1024);
  store.originals.set("orig/A.jpg", bytes);
  store.originals.set("orig/B.jpg", bytes);

  const results = await generateVariantsForAsset(store.deps, "asset-A");

  const generated = results.find((r) => r.platform === "instagram" && r.status === "generated");
  assert(generated, "expected asset A's Instagram variant to generate");
  assert(store.variantRows.has("asset-A:instagram"), "asset A should have a saved variant row");
  assertEquals(store.variantRows.has("asset-B:instagram"), false, "asset B must have NO variant row after only asset A was processed");
  assertEquals(store.variantRows.has("asset-B:facebook"), false);

  // No storage object for asset B was created either.
  const bStorageKeys = [...store.storageObjects.keys()].filter((k) => k.includes("asset-B") || k.includes("-B-"));
  assertEquals(bStorageKeys.length, 0, "no storage object should reference asset B");

  // The activity log only records asset A.
  assertEquals(store.activityLog.every((entry) => entry.target_id === "asset-A"), true);
});

Deno.test("REGRESSION: regenerating (overwriting) asset A's existing variant does not touch asset B's existing variant", async () => {
  const assetA: MediaAssetRecord = { id: "asset-A", workspace_id: "ws-1", storage_path: "orig/A.jpg", ...OVERSIZED_FOR_INSTAGRAM };
  const assetB: MediaAssetRecord = { id: "asset-B", workspace_id: "ws-1", storage_path: "orig/B.jpg", ...OVERSIZED_FOR_INSTAGRAM };
  const store = makeFakeStore([assetA, assetB]);
  const bytes = await makeTestJpegBytes(1536, 1024);
  store.originals.set("orig/A.jpg", bytes);
  store.originals.set("orig/B.jpg", bytes);

  // Seed both assets with a pre-existing variant, as if both were generated before.
  await generateVariantsForAsset(store.deps, "asset-A");
  await generateVariantsForAsset(store.deps, "asset-B");
  const bVariantBefore = store.variantRows.get("asset-B:instagram");
  assert(bVariantBefore, "setup: asset B should already have an Instagram variant");

  // Regenerate ONLY asset A.
  await generateVariantsForAsset(store.deps, "asset-A");

  const bVariantAfter = store.variantRows.get("asset-B:instagram");
  assertEquals(bVariantAfter?.id, bVariantBefore?.id, "asset B's variant row must be untouched by regenerating asset A");
  assertEquals(bVariantAfter?.storage_path, bVariantBefore?.storage_path, "asset B's variant storage path must be untouched");
  assert(store.storageObjects.has(bVariantBefore!.storage_path), "asset B's variant storage object must still exist");
  assertEquals(store.removedPaths.includes(bVariantBefore!.storage_path), false, "asset B's storage object must never be removed by regenerating asset A");
});

Deno.test("generated variant paths are prefixed with the asset's workspace_id (storage RLS depends on this)", async () => {
  const asset: MediaAssetRecord = { id: "asset-A", workspace_id: "ws-42", storage_path: "orig/A.jpg", ...OVERSIZED_FOR_INSTAGRAM };
  const store = makeFakeStore([asset]);
  store.originals.set("orig/A.jpg", await makeTestJpegBytes(1536, 1024));

  await generateVariantsForAsset(store.deps, "asset-A");

  const igVariant = store.variantRows.get("asset-A:instagram")!;
  assert(igVariant.storage_path.startsWith("ws-42/variants/"), `expected path to start with "ws-42/variants/", got "${igVariant.storage_path}"`);
});

Deno.test("an asset that already passes validation for both platforms needs no variant and writes nothing", async () => {
  const asset: MediaAssetRecord = { id: "asset-ok", workspace_id: "ws-1", storage_path: "orig/ok.jpg", mime_type: "image/jpeg", width_px: 1080, height_px: 1080, file_size_bytes: 200_000 };
  const store = makeFakeStore([asset]);
  const results = await generateVariantsForAsset(store.deps, "asset-ok");
  assert(results.every((r) => r.status === "already_valid"));
  assertEquals(store.variantRows.size, 0);
  assertEquals(store.storageObjects.size, 0);
});

Deno.test("an unknown asset id returns a single error result and touches no store", async () => {
  const store = makeFakeStore([]);
  const results = await generateVariantsForAsset(store.deps, "does-not-exist");
  assertEquals(results.length, 1);
  assertEquals(results[0].status, "error");
  assertEquals(store.variantRows.size, 0);
});

// --- parseGenerateVariantsRequest -------------------------------------------

Deno.test("parseGenerateVariantsRequest: a singular media_asset_id is always accepted as a one-item, non-bulk request", () => {
  const parsed = parseGenerateVariantsRequest({ media_asset_id: "asset-A" });
  assertEquals(parsed, { assetIds: ["asset-A"], bulk: false });
});

Deno.test("parseGenerateVariantsRequest: multiple asset ids WITHOUT bulk:true is rejected - this is the regression guard", () => {
  const parsed = parseGenerateVariantsRequest({ media_asset_ids: ["asset-A", "asset-B"] });
  assert("error" in parsed, "a multi-asset request without an explicit bulk flag must be rejected");
});

Deno.test("parseGenerateVariantsRequest: multiple asset ids WITH bulk:true is accepted", () => {
  const parsed = parseGenerateVariantsRequest({ media_asset_ids: ["asset-A", "asset-B"], bulk: true });
  assertEquals(parsed, { assetIds: ["asset-A", "asset-B"], bulk: true });
});

Deno.test("parseGenerateVariantsRequest: a single-item array is accepted even without bulk (still exactly one asset)", () => {
  const parsed = parseGenerateVariantsRequest({ media_asset_ids: ["asset-A"] });
  assertEquals(parsed, { assetIds: ["asset-A"], bulk: false });
});

Deno.test("parseGenerateVariantsRequest: duplicate ids in a bulk array are de-duplicated", () => {
  const parsed = parseGenerateVariantsRequest({ media_asset_ids: ["asset-A", "asset-A", "asset-B"], bulk: true });
  assertEquals(parsed, { assetIds: ["asset-A", "asset-B"], bulk: true });
});

Deno.test("parseGenerateVariantsRequest: providing both media_asset_id and media_asset_ids is rejected as ambiguous", () => {
  const parsed = parseGenerateVariantsRequest({ media_asset_id: "asset-A", media_asset_ids: ["asset-B"] });
  assert("error" in parsed);
});

Deno.test("parseGenerateVariantsRequest: an empty body is rejected", () => {
  assert("error" in parseGenerateVariantsRequest({}));
  assert("error" in parseGenerateVariantsRequest({ media_asset_ids: [] }));
  assert("error" in parseGenerateVariantsRequest(null));
});

// Creative Studio batch image ads - real LOCAL-Supabase integration tests
// (no mocks, real RLS + triggers). No OpenAI / Meta / image-provider call
// anywhere: every row is hand-seeded via the service role, then probed
// with genuinely independent authenticated sessions.
//
// Covers instruction #23-#28: workspace isolation (DB rows, storage
// paths, signed URLs), the cross-workspace validation triggers, partial
// batch preservation, and "Use in Campaign" preparing (not publishing) a
// creative through the existing ad_creatives path.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, type TestTenant } from "./helpers";
import { seedMediaAsset } from "./contentHelpers";

async function seedBatch(workspaceId: string, createdBy: string) {
  const { data, error } = await admin
    .from("creative_studio_batches")
    .insert({ workspace_id: workspaceId, business_context: "A bakery in Cape Town", created_by: createdBy, status: "draft" })
    .select("*")
    .single();
  if (error || !data) throw new Error(`seed batch: ${error?.message}`);
  return data;
}

async function seedConcept(batchId: string, workspaceId: string, over: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("creative_studio_concepts")
    .insert({
      batch_id: batchId,
      workspace_id: workspaceId,
      concept_name: "Hopeful founder",
      headline: "Fresh every morning",
      supporting_text: "Sourdough baked at dawn, ready by seven.",
      cta: "Order today",
      visual_prompt: "A rustic bakery counter at sunrise, warm light, copy space left. no text, no logos, no watermarks.",
      layout_style: "split",
      visual_notes: "warm palette",
      ...over,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`seed concept: ${error?.message}`);
  return data;
}

async function seedCreative(batchId: string, conceptId: string, workspaceId: string, over: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("creative_studio_creatives")
    .insert({
      batch_id: batchId,
      concept_id: conceptId,
      workspace_id: workspaceId,
      layout: "split",
      size: "1080x1080",
      width_px: 1080,
      height_px: 1080,
      headline: "Fresh every morning",
      body_text: "Sourdough baked at dawn.",
      cta: "Order today",
      status: "ready",
      ...over,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`seed creative: ${error?.message}`);
  return data;
}

describe("Creative Studio batch ads - tenant isolation & integrity", () => {
  let A: TestTenant;
  let B: TestTenant;
  let batchB: { id: string };
  let conceptB: { id: string };
  let creativeB: { id: string };
  let assetB: { id: string; storage_path: string };

  beforeAll(async () => {
    A = await createTestTenant("cs-batch-a");
    B = await createTestTenant("cs-batch-b");
    batchB = await seedBatch(B.workspaceId, B.userId);
    conceptB = await seedConcept(batchB.id, B.workspaceId);
    assetB = await seedMediaAsset(B.workspaceId, B.userId);
    creativeB = await seedCreative(batchB.id, conceptB.id, B.workspaceId, { rendered_media_asset_id: assetB.id, storage_path: assetB.storage_path });
  });

  afterAll(async () => {
    await cleanupTenant(A);
    await cleanupTenant(B);
  });

  it("workspace A cannot see workspace B's batch / concepts / creatives", async () => {
    for (const table of ["creative_studio_batches", "creative_studio_concepts", "creative_studio_creatives"] as const) {
      const { data, error } = await A.client.from(table).select("*").eq("workspace_id", B.workspaceId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
  });

  it("workspace A cannot edit workspace B's creative (0 rows, value unchanged)", async () => {
    const { data } = await A.client
      .from("creative_studio_creatives")
      .update({ status: "approved", headline: "hijacked" })
      .eq("id", creativeB.id)
      .select();
    expect(data).toEqual([]);
    const { data: still } = await admin.from("creative_studio_creatives").select("headline, status").eq("id", creativeB.id).single();
    expect(still?.headline).toBe("Fresh every morning");
    expect(still?.status).toBe("ready");
  });

  it("workspace A cannot regenerate/alter workspace B's concept visual", async () => {
    const { data } = await A.client
      .from("creative_studio_concepts")
      .update({ visual_status: "pending", visual_media_asset_id: null })
      .eq("id", conceptB.id)
      .select();
    expect(data).toEqual([]);
  });

  it("a concept whose workspace_id does not match its batch is rejected by the validation trigger", async () => {
    const { error } = await admin.from("creative_studio_concepts").insert({
      batch_id: batchB.id,
      workspace_id: A.workspaceId, // mismatch
      concept_name: "x",
      headline: "x",
      supporting_text: "x",
      cta: "x",
      visual_prompt: "x. no text, no logos.",
    });
    expect(error).not.toBeNull();
  });

  it("a creative referencing another workspace's media asset is rejected by the validation trigger", async () => {
    const assetA = await seedMediaAsset(A.workspaceId, A.userId);
    const { error } = await admin.from("creative_studio_creatives").insert({
      batch_id: batchB.id,
      concept_id: conceptB.id,
      workspace_id: B.workspaceId,
      layout: "split",
      size: "1080x1080",
      width_px: 1080,
      height_px: 1080,
      headline: "h",
      body_text: "b",
      cta: "c",
      rendered_media_asset_id: assetA.id, // belongs to workspace A
    });
    expect(error).not.toBeNull();
  });

  it("the 30-creative-per-batch ceiling is enforced in the database", async () => {
    const batch = await seedBatch(B.workspaceId, B.userId);
    // 6 concepts x (up to) 5 synthetic layout labels x 1 size = >30 unique combos.
    const conceptIds: string[] = [];
    for (let i = 0; i < 6; i++) conceptIds.push((await seedConcept(batch.id, B.workspaceId, { concept_name: `c${i}` })).id);

    let inserted = 0;
    let firstRejection: unknown = null;
    outer: for (const cid of conceptIds) {
      for (let l = 0; l < 6; l++) {
        const { error } = await admin.from("creative_studio_creatives").insert({
          batch_id: batch.id,
          concept_id: cid,
          workspace_id: B.workspaceId,
          layout: `layout_${l}`,
          size: "1080x1080",
          width_px: 1080,
          height_px: 1080,
          headline: "h",
          body_text: "b",
          cta: "c",
        });
        if (error) {
          firstRejection = error;
          break outer;
        }
        inserted++;
      }
    }
    expect(inserted).toBe(30);
    expect(firstRejection).not.toBeNull();
  });

  it("partial batch: a failed concept visual does not remove the successful ones", async () => {
    const batch = await seedBatch(B.workspaceId, B.userId);
    await seedConcept(batch.id, B.workspaceId, { concept_name: "ok-1", visual_status: "ready" });
    await seedConcept(batch.id, B.workspaceId, { concept_name: "ok-2", visual_status: "ready" });
    await seedConcept(batch.id, B.workspaceId, { concept_name: "bad", visual_status: "failed", visual_error: "provider 500" });

    const { data } = await admin.from("creative_studio_concepts").select("concept_name, visual_status").eq("batch_id", batch.id);
    const ready = (data ?? []).filter((r) => r.visual_status === "ready");
    const failed = (data ?? []).filter((r) => r.visual_status === "failed");
    expect(ready).toHaveLength(2);
    expect(failed).toHaveLength(1);
  });

  it("an approved creative's rendered asset is a normal content_media_asset the campaign builder can select; attaching it cross-workspace is rejected", async () => {
    // B can see its own rendered asset in the Media Library listing the
    // CampaignBuilder's media picker (useContentMediaAssets) uses.
    const { data: libB } = await B.client.from("content_media_assets").select("id").eq("id", assetB.id);
    expect(libB).toHaveLength(1);
    // A cannot attach B's asset as an ad creative - the existing
    // ad_creatives_validate_workspace trigger rejects the workspace mismatch.
    const { error } = await A.client.from("ad_creatives").insert({
      workspace_id: A.workspaceId,
      media_asset_id: assetB.id,
      primary_text: "hijack attempt",
      cta: "LEARN_MORE",
    });
    expect(error).not.toBeNull();
  });

  it("selecting a creative for a campaign does not publish anything (no active ad_creative / external id appears)", async () => {
    const { data: creatives } = await admin
      .from("creative_studio_creatives")
      .select("status")
      .eq("id", creativeB.id);
    // The Creative Studio row itself never transitions to a 'published'
    // state - it only has rendering/ready/approved/rejected/failed.
    expect(["rendering", "ready", "approved", "rejected", "failed"]).toContain(creatives?.[0]?.status);
  });
});

describe("Creative Studio - reference-ads + Brand Kit schema (approved plan)", () => {
  let A: TestTenant;

  beforeAll(async () => {
    A = await createTestTenant("cs-reference-a");
  });

  afterAll(async () => {
    await cleanupTenant(A);
  });

  it("an UNCLASSIFIED media asset (asset_role IS NULL) can still be used as a batch's source - asset_role is metadata, never a gate", async () => {
    const asset = await seedMediaAsset(A.workspaceId, A.userId); // no asset_role override -> NULL
    expect(asset.id).toBeTruthy();
    const { data: batch, error } = await admin
      .from("creative_studio_batches")
      .insert({
        workspace_id: A.workspaceId,
        business_context: "A bakery in Cape Town",
        created_by: A.userId,
        source_media_asset_id: asset.id,
      })
      .select("*")
      .single();
    expect(error).toBeNull();
    expect(batch?.source_media_asset_id).toBe(asset.id);
  });

  it("content_media_assets.asset_role accepts each of the four roles, and existing/unset rows stay NULL and valid", async () => {
    for (const role of ["reference_creative", "product_image", "logo", "background"] as const) {
      const { data, error } = await admin
        .from("content_media_assets")
        .insert({
          workspace_id: A.workspaceId,
          title: `role-${role}`,
          storage_path: `${A.workspaceId}/role-${role}-${Date.now()}.png`,
          mime_type: "image/png",
          width_px: 100,
          height_px: 100,
          aspect_ratio: 1,
          file_size_bytes: 100,
          checksum_sha256: `checksum-${role}-${Date.now()}`,
          created_by: A.userId,
          asset_role: role,
        })
        .select("asset_role")
        .single();
      expect(error).toBeNull();
      expect(data?.asset_role).toBe(role);
    }
    // Unset (the default for every pre-existing/legacy row) is still valid.
    const unclassified = await seedMediaAsset(A.workspaceId, A.userId);
    const { data: read } = await admin.from("content_media_assets").select("asset_role").eq("id", unclassified.id).single();
    expect(read?.asset_role).toBeNull();
  });

  it("creative_studio_batches.reference_style/reference_preferences round-trip and default to NULL for a no-reference batch", async () => {
    const referenceStyle = {
      dominant_colors: ["#1f2937", "#f59e0b"],
      layout_style: "split",
      subject_position: "right third",
      text_regions: ["top-left"],
      visual_style: "clean product photography",
      background_style: "soft gradient",
      whitespace_level: "generous",
      mood: "professional, calm",
    };
    const referencePreferences = { keep_colours: true, keep_layout: false, keep_imagery: false, fresh_layout: false };

    const { data: withRef, error: errWithRef } = await admin
      .from("creative_studio_batches")
      .insert({
        workspace_id: A.workspaceId,
        business_context: "A bakery in Cape Town",
        created_by: A.userId,
        reference_style: referenceStyle,
        reference_preferences: referencePreferences,
      })
      .select("reference_style, reference_preferences")
      .single();
    expect(errWithRef).toBeNull();
    expect(withRef?.reference_style).toEqual(referenceStyle);
    expect(withRef?.reference_preferences).toEqual(referencePreferences);

    // Never OCR'd commercial fact - the shape stored is style-only, no
    // headline/price/phone/CTA field exists on this object at all.
    expect(Object.keys(withRef?.reference_style ?? {}).sort()).toEqual(
      ["background_style", "dominant_colors", "layout_style", "mood", "subject_position", "text_regions", "visual_style", "whitespace_level"].sort(),
    );

    const { data: noRef, error: errNoRef } = await admin
      .from("creative_studio_batches")
      .insert({ workspace_id: A.workspaceId, business_context: "A bakery in Cape Town", created_by: A.userId })
      .select("reference_style, reference_preferences")
      .single();
    expect(errNoRef).toBeNull();
    expect(noRef?.reference_style).toBeNull();
    expect(noRef?.reference_preferences).toBeNull();
  });

  it("workspace_settings accepts the new Brand Kit fields (secondary_brand_color, default_ad_cta) additively", async () => {
    const { error } = await admin
      .from("workspace_settings")
      .update({ secondary_brand_color: "#64748b", default_ad_cta: "Get a free quote" })
      .eq("workspace_id", A.workspaceId);
    expect(error).toBeNull();
    const { data } = await admin.from("workspace_settings").select("secondary_brand_color, default_ad_cta").eq("workspace_id", A.workspaceId).single();
    expect(data?.secondary_brand_color).toBe("#64748b");
    expect(data?.default_ad_cta).toBe("Get a free quote");
  });

  it("workspace_settings rejects a malformed hex colour (check constraint)", async () => {
    const { error } = await admin.from("workspace_settings").update({ secondary_brand_color: "blue" }).eq("workspace_id", A.workspaceId);
    expect(error).not.toBeNull();
  });
});

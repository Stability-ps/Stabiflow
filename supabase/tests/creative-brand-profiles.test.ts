// Creative Brand Profiles - real LOCAL-Supabase integration tests (no
// mocks, real RLS + triggers). No OpenAI / Meta / image-provider call
// anywhere. Covers instruction #23 (workspace isolation), #3-#4
// (multiple profiles, one default), #17 (logo ownership isolation), and
// #7 (a batch's brand_snapshot is independent of the live profile once
// captured - editing/deleting the profile afterwards never repaints it).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, type TestTenant } from "./helpers";
import { seedMediaAsset } from "./contentHelpers";

async function seedProfile(workspaceId: string, over: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("creative_brand_profiles")
    .insert({ workspace_id: workspaceId, name: "Main brand", company_name: "Acme Co", ...over })
    .select("*")
    .single();
  if (error || !data) throw new Error(`seed profile: ${error?.message}`);
  return data;
}

describe("Creative Brand Profiles - isolation, defaults, and snapshot independence", () => {
  let A: TestTenant;
  let B: TestTenant;
  let profileB: { id: string };

  beforeAll(async () => {
    A = await createTestTenant("brand-profiles-a");
    B = await createTestTenant("brand-profiles-b");
    profileB = await seedProfile(B.workspaceId, { is_default: true });
  });

  afterAll(async () => {
    await cleanupTenant(A);
    await cleanupTenant(B);
  });

  it("workspace A cannot see workspace B's brand profile", async () => {
    const { data, error } = await A.client.from("creative_brand_profiles").select("*").eq("workspace_id", B.workspaceId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("workspace A cannot edit workspace B's brand profile (0 rows, value unchanged)", async () => {
    const { data } = await A.client.from("creative_brand_profiles").update({ company_name: "Hijacked" }).eq("id", profileB.id).select();
    expect(data).toEqual([]);
    const { data: still } = await admin.from("creative_brand_profiles").select("company_name").eq("id", profileB.id).single();
    expect(still?.company_name).toBe("Acme Co");
  });

  it("workspace A cannot delete workspace B's brand profile", async () => {
    const { data } = await A.client.from("creative_brand_profiles").delete().eq("id", profileB.id).select();
    expect(data).toEqual([]);
    const { data: still } = await admin.from("creative_brand_profiles").select("id").eq("id", profileB.id).maybeSingle();
    expect(still?.id).toBe(profileB.id);
  });

  it("a workspace can have multiple named brand profiles", async () => {
    const p1 = await seedProfile(A.workspaceId, { name: "Brand One", company_name: "One Ltd" });
    const p2 = await seedProfile(A.workspaceId, { name: "Brand Two", company_name: "Two Ltd" });
    const { data } = await admin.from("creative_brand_profiles").select("id").eq("workspace_id", A.workspaceId);
    const ids = (data ?? []).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([p1.id, p2.id]));
  });

  it("at most one default profile per workspace is enforced by the DB", async () => {
    await seedProfile(A.workspaceId, { name: "First default", company_name: "First Ltd", is_default: true });
    const { error } = await admin.from("creative_brand_profiles").insert({
      workspace_id: A.workspaceId,
      name: "Second default",
      company_name: "Second Ltd",
      is_default: true,
    });
    expect(error).not.toBeNull();
  });

  it("a profile logo referencing another workspace's media asset is rejected by the validation trigger", async () => {
    const assetB = await seedMediaAsset(B.workspaceId, B.userId);
    const { error } = await admin.from("creative_brand_profiles").insert({
      workspace_id: A.workspaceId,
      name: "Bad logo",
      company_name: "Bad Ltd",
      logo_media_asset_id: assetB.id,
    });
    expect(error).not.toBeNull();
  });

  it("a batch's brand_snapshot is captured once and stays independent of later profile edits or deletion", async () => {
    const profile = await seedProfile(A.workspaceId, { name: "Snapshot test", company_name: "Snapshot Co", contact_phone: "012 000 0000" });
    const { data: batch, error: batchErr } = await admin
      .from("creative_studio_batches")
      .insert({
        workspace_id: A.workspaceId,
        business_context: "A bakery",
        status: "draft",
        created_by: A.userId,
        brand_profile_id: profile.id,
        brand_snapshot: { name: profile.company_name, contactPhone: profile.contact_phone, primary: null },
      })
      .select("*")
      .single();
    expect(batchErr).toBeNull();
    expect(batch?.brand_snapshot?.contactPhone).toBe("012 000 0000");

    // The brand changes its phone number next month...
    await admin.from("creative_brand_profiles").update({ contact_phone: "099 999 9999" }).eq("id", profile.id);
    const { data: afterEdit } = await admin.from("creative_studio_batches").select("brand_snapshot").eq("id", batch!.id).single();
    expect(afterEdit?.brand_snapshot?.contactPhone).toBe("012 000 0000");

    // ...or the profile is deleted entirely (brand_profile_id -> null,
    // ON DELETE SET NULL) - the snapshot still survives untouched.
    await admin.from("creative_brand_profiles").delete().eq("id", profile.id);
    const { data: afterDelete } = await admin.from("creative_studio_batches").select("brand_snapshot, brand_profile_id").eq("id", batch!.id).single();
    expect(afterDelete?.brand_snapshot?.contactPhone).toBe("012 000 0000");
    expect(afterDelete?.brand_profile_id).toBeNull();
  });
});

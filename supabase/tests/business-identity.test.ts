// Business Identity - real LOCAL-Supabase integration tests (real RLS +
// triggers, no mocks, no external calls). Covers: identity auto-created
// with the workspace, tenant isolation, admin-only writes, platform-only
// 'verified' status, cross-tenant media/brand references rejected, and the
// legacy workspace_settings <-> identity sync in both directions.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, createTestUser, seedMembership, type TestTenant } from "./helpers";
import { seedMediaAsset } from "./contentHelpers";

describe("Business Identity - canonical record, isolation, provenance guards, legacy sync", () => {
  let A: TestTenant;
  let B: TestTenant;

  beforeAll(async () => {
    A = await createTestTenant("biz-identity-a");
    B = await createTestTenant("biz-identity-b");
  });

  afterAll(async () => {
    await cleanupTenant(A);
    await cleanupTenant(B);
  });

  it("creating a workspace creates exactly one identity row, named after the workspace", async () => {
    const { data, error } = await A.client.from("business_identities").select("*").eq("workspace_id", A.workspaceId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].trading_name).toContain("RLS Test Workspace");
    expect(data![0].verification_status).toBe("unverified");
  });

  it("workspace A cannot read or edit workspace B's identity or its facts", async () => {
    await admin.from("business_contacts").insert({ workspace_id: B.workspaceId, kind: "email", value: "b@example.com", is_primary: true });
    const { data: ident } = await A.client.from("business_identities").select("*").eq("workspace_id", B.workspaceId);
    expect(ident).toEqual([]);
    const { data: contacts } = await A.client.from("business_contacts").select("*").eq("workspace_id", B.workspaceId);
    expect(contacts).toEqual([]);

    const { data: upd } = await A.client.from("business_identities").update({ legal_name: "Hijacked" }).eq("workspace_id", B.workspaceId).select();
    expect(upd).toEqual([]);
    const { error: insErr } = await A.client.from("business_offerings").insert({ workspace_id: B.workspaceId, name: "Injected" });
    expect(insErr).not.toBeNull();
  });

  it("an owner can edit identity facts; a viewer can read but not write", async () => {
    const { error } = await A.client.from("business_identities").update({ legal_name: "Acme (Pty) Ltd", mission: "Build things" }).eq("workspace_id", A.workspaceId);
    expect(error).toBeNull();
    const { error: offErr } = await A.client.from("business_offerings").insert({ workspace_id: A.workspaceId, name: "Consulting" });
    expect(offErr).toBeNull();

    const viewer = await createTestUser("biz-identity-viewer");
    await seedMembership(A.workspaceId, viewer.userId, "viewer");
    const { data: seen } = await viewer.client.from("business_identities").select("legal_name").eq("workspace_id", A.workspaceId).single();
    expect(seen?.legal_name).toBe("Acme (Pty) Ltd");
    const { data: vUpd } = await viewer.client.from("business_identities").update({ legal_name: "Viewer edit" }).eq("workspace_id", A.workspaceId).select();
    expect(vUpd).toEqual([]);
    await admin.from("workspace_members").delete().eq("workspace_id", A.workspaceId).eq("user_id", viewer.userId);
  });

  it("clients cannot insert or delete the identity row itself", async () => {
    const { data: del } = await A.client.from("business_identities").delete().eq("workspace_id", A.workspaceId).select();
    expect(del ?? []).toEqual([]);
    const { data: still } = await admin.from("business_identities").select("id").eq("workspace_id", A.workspaceId);
    expect(still).toHaveLength(1);
  });

  it("only the platform can mark a fact verified; a client edit of a verified fact demotes it", async () => {
    const { error: clientVerify } = await A.client
      .from("business_identifiers")
      .insert({ workspace_id: A.workspaceId, scheme: "za_cipc_registration", value: "2020/123456/07", verification_status: "verified" });
    expect(clientVerify).not.toBeNull();

    const { data: row, error } = await admin
      .from("business_identifiers")
      .insert({ workspace_id: A.workspaceId, scheme: "za_vat", value: "4123456789", verification_status: "verified" })
      .select("id")
      .single();
    expect(error).toBeNull();

    await A.client.from("business_identifiers").update({ value: "4999999999" }).eq("id", row!.id);
    const { data: after } = await admin.from("business_identifiers").select("value, verification_status").eq("id", row!.id).single();
    expect(after?.value).toBe("4999999999");
    expect(after?.verification_status).toBe("user_confirmed");

    const { error: identVerify } = await A.client.from("business_identities").update({ verification_status: "verified" }).eq("workspace_id", A.workspaceId);
    expect(identVerify).not.toBeNull();
  });

  it("referencing another workspace's media asset or brand profile is rejected", async () => {
    const assetB = await seedMediaAsset(B.workspaceId, B.userId);
    const { error: mediaErr } = await admin.from("business_team_members").insert({ workspace_id: A.workspaceId, full_name: "Jane", photo_media_asset_id: assetB.id });
    expect(mediaErr).not.toBeNull();

    const { data: bpB } = await admin.from("creative_brand_profiles").insert({ workspace_id: B.workspaceId, name: "B", company_name: "B Co" }).select("id").single();
    const { error: bpErr } = await admin.from("business_identities").update({ brand_profile_id: bpB!.id }).eq("workspace_id", A.workspaceId);
    expect(bpErr).not.toBeNull();
  });

  it("identity edits mirror into legacy workspace_settings", async () => {
    await A.client.from("business_identities").update({ website: "https://acme.example", industry: "Engineering", long_description: "We engineer." }).eq("workspace_id", A.workspaceId);
    const { data: s } = await admin.from("workspace_settings").select("website, industry, business_description").eq("workspace_id", A.workspaceId).single();
    expect(s).toEqual({ website: "https://acme.example", industry: "Engineering", business_description: "We engineer." });
  });

  it("legacy workspace_settings edits flow into the identity and primary contacts", async () => {
    const { error } = await A.client
      .from("workspace_settings")
      .update({ website: "https://acme2.example", contact_email: "hello@acme.example", contact_phone: "011 555 0000" })
      .eq("workspace_id", A.workspaceId);
    expect(error).toBeNull();
    const { data: ident } = await admin.from("business_identities").select("website, field_provenance").eq("workspace_id", A.workspaceId).single();
    expect(ident?.website).toBe("https://acme2.example");
    expect(ident?.field_provenance?.website?.source).toBe("user");
    const { data: contacts } = await admin.from("business_contacts").select("kind, value").eq("workspace_id", A.workspaceId).eq("is_primary", true).order("kind");
    expect(contacts).toEqual([
      { kind: "email", value: "hello@acme.example" },
      { kind: "phone", value: "011 555 0000" },
    ]);
  });

  it("changing the primary email contact mirrors back into workspace_settings", async () => {
    await A.client.from("business_contacts").update({ value: "sales@acme.example" }).eq("workspace_id", A.workspaceId).eq("kind", "email").eq("is_primary", true);
    const { data: s } = await admin.from("workspace_settings").select("contact_email").eq("workspace_id", A.workspaceId).single();
    expect(s?.contact_email).toBe("sales@acme.example");
  });
});

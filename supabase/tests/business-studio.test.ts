// Business Studio SQL layer - LOCAL-Supabase integration tests. No network
// fetches and no AI: proposals are seeded directly the way the scan runner
// writes them.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { admin, ANON_KEY, cleanupTenant, createTestTenant, createTestUser, seedMembership, SUPABASE_URL, type TestTenant } from "./helpers";

const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

async function propose(ws: string, row: Record<string, unknown>) {
  const { data, error } = await admin
    .from("business_fact_proposals")
    .insert({ workspace_id: ws, origin: "website_scan", extraction_method: "pattern", evidence: "on the site", evidence_url: "https://acme.example/", ...row })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data!.id as string;
}

async function grantBusiness(ws: string) {
  const { data: plan } = await admin.from("billing_plans").select("id").eq("code", "business").single();
  await admin.from("workspace_subscriptions").insert({ workspace_id: ws, plan_id: plan!.id, status: "active", current_period_end: new Date(Date.now() + 20 * 86400000).toISOString() });
}

describe("Business Studio - proposals, publishing, monitoring, public profile", () => {
  let A: TestTenant;
  let B: TestTenant;

  beforeAll(async () => {
    A = await createTestTenant("bstudio-a");
    B = await createTestTenant("bstudio-b");
  });

  afterAll(async () => {
    await cleanupTenant(A);
    await cleanupTenant(B);
  });

  it("accepting an identity-field proposal applies it with provenance and supersedes competing proposals", async () => {
    const p1 = await propose(A.workspaceId, { target: "identity_field", field: "legal_name", proposed: { value: "Acme Engineering (Pty) Ltd" } });
    const p2 = await propose(A.workspaceId, { target: "identity_field", field: "legal_name", proposed: { value: "Acme Eng" }, extraction_method: "ai_extraction" });
    const { data, error } = await A.client.rpc("accept_business_fact_proposal", { p_proposal_id: p1, p_edited: null });
    expect(error).toBeNull();
    expect(data).toBe("accepted");
    const { data: ident } = await admin.from("business_identities").select("legal_name, field_provenance").eq("workspace_id", A.workspaceId).single();
    expect(ident?.legal_name).toBe("Acme Engineering (Pty) Ltd");
    expect(ident?.field_provenance?.legal_name?.source).toBe("website_scan");
    const { data: other } = await admin.from("business_fact_proposals").select("status").eq("id", p2).single();
    expect(other?.status).toBe("superseded");
  });

  it("the customer can correct a value while accepting; list facts land confirmed with the website as source", async () => {
    const p = await propose(A.workspaceId, { target: "offering", proposed: { name: "Steel fab", description: null } });
    await A.client.rpc("accept_business_fact_proposal", { p_proposal_id: p, p_edited: { name: "Structural Steel Fabrication", kind: "service" } });
    const { data: off } = await admin.from("business_offerings").select("name, source, verification_status, source_ref").eq("workspace_id", A.workspaceId).single();
    expect(off).toMatchObject({ name: "Structural Steel Fabrication", source: "website_scan", verification_status: "user_confirmed", source_ref: "https://acme.example/" });
  });

  it("founded_year and core_values are cast correctly; disallowed fields are refused", async () => {
    const y = await propose(A.workspaceId, { target: "identity_field", field: "founded_year", proposed: { value: 2004 } });
    await A.client.rpc("accept_business_fact_proposal", { p_proposal_id: y, p_edited: null });
    const v = await propose(A.workspaceId, { target: "identity_field", field: "core_values", proposed: { value: ["Safety", "Integrity"] } });
    await A.client.rpc("accept_business_fact_proposal", { p_proposal_id: v, p_edited: null });
    const { data: ident } = await admin.from("business_identities").select("founded_year, core_values").eq("workspace_id", A.workspaceId).single();
    expect(ident).toEqual({ founded_year: 2004, core_values: ["Safety", "Integrity"] });

    const bad = await propose(A.workspaceId, { target: "identity_field", field: "verification_status", proposed: { value: "verified" } });
    const { error } = await A.client.rpc("accept_business_fact_proposal", { p_proposal_id: bad, p_edited: null });
    expect(error).not.toBeNull();
  });

  it("rejecting leaves the identity untouched; reviewing twice is a no-op", async () => {
    const p = await propose(A.workspaceId, { target: "contact", proposed: { kind: "email", value: "spam@evil.example" } });
    expect((await A.client.rpc("reject_business_fact_proposal", { p_proposal_id: p })).data).toBe("rejected");
    expect((await A.client.rpc("accept_business_fact_proposal", { p_proposal_id: p, p_edited: null })).data).toBe("already_rejected");
    const { data } = await admin.from("business_contacts").select("value").eq("workspace_id", A.workspaceId).eq("value", "spam@evil.example");
    expect(data).toEqual([]);
  });

  it("another workspace and non-admin members cannot review proposals", async () => {
    const p = await propose(A.workspaceId, { target: "offering", proposed: { name: "Welding" } });
    const { error: cross } = await B.client.rpc("accept_business_fact_proposal", { p_proposal_id: p, p_edited: null });
    expect(cross).not.toBeNull();
    const viewer = await createTestUser("bstudio-viewer");
    await seedMembership(A.workspaceId, viewer.userId, "viewer");
    const { error: v } = await viewer.client.rpc("reject_business_fact_proposal", { p_proposal_id: p });
    expect(v).not.toBeNull();
    const { data: seen } = await viewer.client.from("business_fact_proposals").select("id").eq("id", p);
    expect(seen).toHaveLength(1);
    await admin.from("workspace_members").delete().eq("workspace_id", A.workspaceId).eq("user_id", viewer.userId);
    const { data: crossRead } = await B.client.from("business_fact_proposals").select("id").eq("workspace_id", A.workspaceId);
    expect(crossRead).toEqual([]);
  });

  it("clients cannot write proposals, scans or documents directly", async () => {
    const { error: e1 } = await A.client.from("business_fact_proposals").insert({ workspace_id: A.workspaceId, origin: "website_scan", target: "offering", proposed: { name: "x" }, extraction_method: "pattern" });
    expect(e1).not.toBeNull();
    const { error: e2 } = await A.client.from("website_scans").insert({ workspace_id: A.workspaceId, requested_url: "https://x.example" });
    expect(e2).not.toBeNull();
    const { error: e3 } = await A.client.from("business_documents").insert({ workspace_id: A.workspaceId, title: "x", template_key: "classic", content: {}, watermarked: false });
    expect(e3).not.toBeNull();
  });

  it("publishing a hosted profile requires the subscription entitlement", async () => {
    const slug = `acme-${Date.now()}`;
    const { error: draftErr } = await A.client.from("hosted_profiles").insert({ workspace_id: A.workspaceId, slug, is_published: false });
    expect(draftErr).toBeNull();
    const { error: pubErr } = await A.client.from("hosted_profiles").update({ is_published: true }).eq("workspace_id", A.workspaceId);
    expect(pubErr).not.toBeNull();
    expect((await anon.rpc("get_public_business_profile", { p_slug: slug })).data).toBeNull();

    await grantBusiness(A.workspaceId);
    const { error: ok } = await A.client.from("hosted_profiles").update({ is_published: true }).eq("workspace_id", A.workspaceId);
    expect(ok).toBeNull();

    // Public read: public facts only; private identifiers/contacts excluded.
    await admin.from("business_identifiers").insert({ workspace_id: A.workspaceId, scheme: "za_vat", value: "4123456789", is_public: false });
    await admin.from("business_contacts").insert({ workspace_id: A.workspaceId, kind: "phone", value: "011 999 0000", is_public: false });
    const { data: pub } = await anon.rpc("get_public_business_profile", { p_slug: slug });
    expect(pub?.identity?.legal_name).toBe("Acme Engineering (Pty) Ltd");
    expect(JSON.stringify(pub)).not.toContain("4123456789");
    expect(JSON.stringify(pub)).not.toContain("011 999 0000");
    expect(pub?.offerings?.[0]?.name).toBe("Structural Steel Fabrication");

    // Subscription lapses -> the public profile disappears without deletion.
    await admin.from("workspace_subscriptions").update({ status: "expired" }).eq("workspace_id", A.workspaceId);
    expect((await anon.rpc("get_public_business_profile", { p_slug: slug })).data).toBeNull();
    const { data: still } = await admin.from("hosted_profiles").select("is_published").eq("workspace_id", A.workspaceId).single();
    expect(still?.is_published).toBe(true);
  });

  it("anonymous visitors cannot read business tables directly", async () => {
    const { data } = await anon.from("business_identities").select("*");
    expect(data ?? []).toEqual([]);
    const { data: hp } = await anon.from("hosted_profiles").select("*");
    expect(hp ?? []).toEqual([]);
  });

  it("slugs are unique across workspaces and validated", async () => {
    const { data: a } = await admin.from("hosted_profiles").select("slug").eq("workspace_id", A.workspaceId).single();
    const { error } = await B.client.from("hosted_profiles").insert({ workspace_id: B.workspaceId, slug: a!.slug });
    expect(error).not.toBeNull();
    const { error: bad } = await B.client.from("hosted_profiles").insert({ workspace_id: B.workspaceId, slug: "Bad Slug!" });
    expect(bad).not.toBeNull();
  });

  it("website monitoring requires the entitlement, and clients cannot move the schedule", async () => {
    const { error: denied } = await B.client.from("website_monitors").insert({ workspace_id: B.workspaceId, url: "https://b.example" });
    expect(denied).not.toBeNull();
    await grantBusiness(B.workspaceId);
    const { error } = await B.client.from("website_monitors").insert({ workspace_id: B.workspaceId, url: "https://b.example", frequency_days: 14 });
    expect(error).toBeNull();
    await B.client.from("website_monitors").update({ next_check_at: new Date().toISOString(), last_scan_id: null }).eq("workspace_id", B.workspaceId);
    const { data: m } = await admin.from("website_monitors").select("next_check_at").eq("workspace_id", B.workspaceId).single();
    expect(Date.parse(m!.next_check_at)).toBeGreaterThan(Date.now() + 13 * 86400000);
  });

  it("documents in storage are readable by members of the owning workspace only", async () => {
    const path = `${A.workspaceId}/${crypto.randomUUID()}.pdf`;
    await admin.storage.from("business-documents").upload(path, new Blob(["%PDF-1.4"]), { contentType: "application/pdf" });
    const own = await A.client.storage.from("business-documents").createSignedUrl(path, 60);
    expect(own.error).toBeNull();
    const other = await B.client.storage.from("business-documents").createSignedUrl(path, 60);
    expect(other.error).not.toBeNull();
    const up = await A.client.storage.from("business-documents").upload(`${A.workspaceId}/forged.pdf`, new Blob(["x"]), { contentType: "application/pdf" });
    expect(up.error).not.toBeNull();
    await admin.storage.from("business-documents").remove([path]);
  });
});

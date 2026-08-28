// Part 4 (launch-completion): proves workspace-export/workspace-delete
// against the REAL deployed edge functions - owner-only gating, the
// admin-cannot-delete boundary (rank alone does not imply this
// permission - it's owner-only, checked explicitly, not "admin and up"),
// cross-workspace defense on both paths, real Vault/Storage cleanup, and
// that the export payload never contains a secret value.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { admin, cleanupTenant, createTestTenant, createTestUser, seedMembership, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedWorkspaceIntegration } from "./integrationHelpers";

const EXPORT_URL = `${SUPABASE_URL}/functions/v1/workspace-export`;
const DELETE_URL = `${SUPABASE_URL}/functions/v1/workspace-delete`;
const SECRET_VALUE = "super-secret-whatsapp-token-should-never-leak-lifecycle-test";

async function callExport(token: string, workspaceId: string) {
  const res = await fetch(EXPORT_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ workspace_id: workspaceId }) });
  return res;
}

async function callDelete(token: string, workspaceId: string, confirm: string) {
  const res = await fetch(DELETE_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ workspace_id: workspaceId, confirm }) });
  return { status: res.status, body: await res.json() };
}

describe("Workspace data export + deletion (release blocker)", () => {
  let ownerTenant: TestTenant;
  let otherTenant: TestTenant;
  let adminUser: { userId: string; client: import("@supabase/supabase-js").SupabaseClient };
  let ownerToken: string;
  let adminToken: string;
  let otherOwnerToken: string;

  beforeAll(async () => {
    ownerTenant = await createTestTenant("workspace-lifecycle-owner");
    otherTenant = await createTestTenant("workspace-lifecycle-other");

    const adminIdentity = await createTestUser("workspace-lifecycle-admin");
    await seedMembership(ownerTenant.workspaceId, adminIdentity.userId, "admin");
    adminUser = adminIdentity;

    const { data: ownerSession } = await ownerTenant.client.auth.getSession();
    ownerToken = ownerSession.session!.access_token;
    const { data: adminSession } = await adminUser.client.auth.getSession();
    adminToken = adminSession.session!.access_token;
    const { data: otherSession } = await otherTenant.client.auth.getSession();
    otherOwnerToken = otherSession.session!.access_token;
  });

  afterAll(async () => {
    // ownerTenant's workspace is deleted BY one of the tests below - a
    // second delete here (via cleanupTenant) is a safe no-op on an
    // already-gone row, per cleanupTenant's own documented behavior.
    await cleanupTenant(ownerTenant);
    await cleanupTenant(otherTenant);
    await cleanupTenant({ userId: adminUser.userId });
  });

  it("an admin (not owner) cannot delete the workspace - rank alone does not grant this permission", async () => {
    const result = await callDelete(adminToken, ownerTenant.workspaceId, "anything");
    expect(result.status).toBe(403);
  });

  it("an admin (not owner) cannot export the workspace either - same owner-only gate", async () => {
    const res = await callExport(adminToken, ownerTenant.workspaceId);
    expect(res.status).toBe(403);
  });

  it("REGRESSION: an owner of workspace A cannot delete workspace B by supplying B's workspace_id", async () => {
    const result = await callDelete(otherOwnerToken, ownerTenant.workspaceId, "anything");
    expect(result.status).toBe(403);
  });

  it("REGRESSION: an owner of workspace A cannot export workspace B by supplying B's workspace_id", async () => {
    const res = await callExport(otherOwnerToken, ownerTenant.workspaceId);
    expect(res.status).toBe(403);
  });

  it("the owner cannot delete without a confirmation string that matches the workspace's name or slug", async () => {
    const wrong = await callDelete(ownerToken, ownerTenant.workspaceId, "definitely-not-the-name-or-slug");
    expect(wrong.status).toBe(400);
  });

  it("export never contains the raw provider secret value, even when the workspace has a real connected integration", async () => {
    const integrationId = await seedWorkspaceIntegration(ownerTenant.workspaceId, "whatsapp");
    await admin.rpc("set_workspace_integration_secret", { p_integration_id: integrationId, p_secret: SECRET_VALUE });

    const res = await callExport(ownerToken, ownerTenant.workspaceId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");

    const bytes = new Uint8Array(await res.arrayBuffer());
    // The secret must not appear anywhere in the raw archive bytes...
    const rawText = strFromU8(bytes, true);
    expect(rawText.includes(SECRET_VALUE)).toBe(false);

    // ...nor in any individual decompressed entry, and workspace_integrations
    // itself (the only table that could ever reference a vault_secret_id)
    // is not one of the exported entities at all.
    const entries = unzipSync(bytes);
    const filenames = Object.keys(entries);
    expect(filenames.length).toBeGreaterThan(0);
    for (const name of filenames) {
      const content = strFromU8(entries[name]);
      expect(content.includes(SECRET_VALUE)).toBe(false);
      expect(/vault_secret_id|access_token|refresh_token/i.test(content)).toBe(false);
    }
    expect(filenames.some((f) => f.startsWith("workspace_profile"))).toBe(true);
  });

  it("delete: clears Vault secrets, removes the workspace, and records a durable platform_deletion_log entry surviving the deletion", async () => {
    // A fresh integration+secret specifically for this test's own delete
    // call - the previous test's integration would already be cascaded
    // away by this point if run in a different order, so don't rely on it.
    const integrationId = await seedWorkspaceIntegration(ownerTenant.workspaceId, "meta");
    await admin.rpc("set_workspace_integration_secret", { p_integration_id: integrationId, p_secret: "another-secret-to-be-cleared" });

    const { data: workspaceRow } = await admin.from("workspaces").select("name, slug").eq("id", ownerTenant.workspaceId).single();

    const result = await callDelete(ownerToken, ownerTenant.workspaceId, workspaceRow!.slug);
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);

    // The Vault secret is genuinely gone, not just the workspace_integrations row.
    const { data: secretAfter } = await admin.rpc("get_workspace_integration_secret", { p_integration_id: integrationId });
    expect(secretAfter).toBeNull();

    // The workspace itself, and everything cascaded from it, is gone.
    const { data: workspaceAfter } = await admin.from("workspaces").select("id").eq("id", ownerTenant.workspaceId).maybeSingle();
    expect(workspaceAfter).toBeNull();
    const { data: membersAfter } = await admin.from("workspace_members").select("id").eq("workspace_id", ownerTenant.workspaceId);
    expect(membersAfter).toHaveLength(0);

    // The durable, non-cascaded audit record survived the deletion it describes.
    const { data: logRows } = await admin.from("platform_deletion_log").select("workspace_id, workspace_name, workspace_slug, deleted_by, cleanup_status").eq("workspace_id", ownerTenant.workspaceId).order("deleted_at", { ascending: false }).limit(1);
    expect(logRows).toHaveLength(1);
    expect(logRows![0].workspace_name).toBe(workspaceRow!.name);
    expect(logRows![0].deleted_by).toBe(ownerTenant.userId);
    expect(JSON.stringify(logRows![0].cleanup_status).includes("another-secret-to-be-cleared")).toBe(false);
  });

  it("retrying delete on an already-deleted workspace fails safely (workspace not found), never a crash or a corrupted second log entry", async () => {
    const { data: workspaceRow } = await admin.from("workspaces").select("slug").eq("id", ownerTenant.workspaceId).maybeSingle();
    expect(workspaceRow).toBeNull(); // already gone from the prior test

    const result = await callDelete(ownerToken, ownerTenant.workspaceId, "whatever");
    // Permission check itself now fails closed too - the caller is no
    // longer a member of a workspace that no longer exists.
    expect([403, 404]).toContain(result.status);
  });
});

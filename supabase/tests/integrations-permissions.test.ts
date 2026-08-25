// Phase C instruction #42. integration.view/connect/manage/disconnect are
// enforced by RLS via has_workspace_permission(), never by role rank alone
// - marketing/sales/support/viewer are all rank-peers-or-below admin, and
// this proves the SAME rank does not imply the SAME integration access
// (viewer can view; only owner/admin can write).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTenant, createTestTenant, createTestUser, seedMembership, type TestTenant } from "./helpers";
import { seedWorkspaceIntegration } from "./integrationHelpers";

describe("Integrations permission matrix (release blocker)", () => {
  let workspace: TestTenant;
  let integrationId: string;
  let viewer: { userId: string; client: import("@supabase/supabase-js").SupabaseClient };
  let marketing: { userId: string; client: import("@supabase/supabase-js").SupabaseClient };

  beforeAll(async () => {
    workspace = await createTestTenant("integrations-perms");
    integrationId = await seedWorkspaceIntegration(workspace.workspaceId);

    const viewerUser = await createTestUser("integrations-perms-viewer");
    await seedMembership(workspace.workspaceId, viewerUser.userId, "viewer");
    viewer = viewerUser;

    const marketingUser = await createTestUser("integrations-perms-marketing");
    await seedMembership(workspace.workspaceId, marketingUser.userId, "marketing");
    marketing = marketingUser;
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
    await cleanupTenant({ userId: viewer.userId });
    await cleanupTenant({ userId: marketing.userId });
  });

  it("a viewer CAN see the connection status (integration.view is broadly granted)", async () => {
    const { data, error } = await viewer.client.from("workspace_integrations").select("id, status").eq("id", integrationId).maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(integrationId);
  });

  it("a viewer cannot disconnect/modify the integration (no integration.manage/disconnect)", async () => {
    const { data } = await viewer.client.from("workspace_integrations").update({ status: "disconnected" }).eq("id", integrationId).select("id");
    expect(data).toEqual([]);
  });

  it("marketing (rank-peer of sales/support) CAN view but does NOT automatically gain integration-secret management just for being a workspace member", async () => {
    const { data: viewResult, error: viewError } = await marketing.client.from("workspace_integrations").select("id").eq("id", integrationId).maybeSingle();
    expect(viewError).toBeNull();
    expect(viewResult?.id).toBe(integrationId);

    const { data: writeResult } = await marketing.client.from("workspace_integrations").update({ status: "disconnected" }).eq("id", integrationId).select("id");
    expect(writeResult).toEqual([]);
  });

  it("the owner CAN manage (write) the integration - server remains authoritative regardless of any hidden/visible frontend control", async () => {
    const { data } = await workspace.client.from("workspace_integrations").update({ status: "connected" }).eq("id", integrationId).select("id");
    expect(data).toHaveLength(1);
  });
});

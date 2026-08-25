// Phase C instruction #17/#18. Proves connect/disconnect/refresh-resources
// against the REAL deployed edge functions: disconnect clears the Vault
// secret and flips status, but never deletes historical resource rows;
// discover-resources re-runs discovery using the already-stored (mock)
// token and never flips is_active on an already-known resource.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, createTestUser, seedMembership, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedFacebookPage } from "./contentHelpers";
import { seedWorkspaceIntegration } from "./integrationHelpers";

async function callDisconnect(token: string, workspaceId: string, provider = "meta") {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/integrations-disconnect`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ workspace_id: workspaceId, provider }),
  });
  return { status: res.status, body: await res.json() };
}

async function callDiscover(token: string, workspaceId: string, provider = "meta") {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/integrations-discover-resources`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ workspace_id: workspaceId, provider }),
  });
  return { status: res.status, body: await res.json() };
}

describe("Integrations disconnect (release blocker)", () => {
  let workspace: TestTenant;
  let integrationId: string;
  let pageId: string;
  let viewer: { userId: string; client: import("@supabase/supabase-js").SupabaseClient };

  beforeAll(async () => {
    workspace = await createTestTenant("integrations-disconnect");
    integrationId = await seedWorkspaceIntegration(workspace.workspaceId);
    await admin.rpc("set_workspace_integration_secret", { p_integration_id: integrationId, p_secret: "token-to-be-cleared" });
    pageId = await seedFacebookPage(workspace.workspaceId, integrationId, { page_name: "Historical Page" });

    const viewerUser = await createTestUser("integrations-disconnect-viewer");
    await seedMembership(workspace.workspaceId, viewerUser.userId, "viewer");
    viewer = viewerUser;
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
    await cleanupTenant({ userId: viewer.userId });
  });

  it("a viewer (no integration.disconnect) cannot disconnect", async () => {
    const { data: session } = await viewer.client.auth.getSession();
    const result = await callDisconnect(session.session!.access_token, workspace.workspaceId);
    expect(result.status).toBe(403);
  });

  it("the owner CAN disconnect: status flips, disconnected_at is stamped, the Vault secret is cleared, but the historical Page row is NOT deleted", async () => {
    const { data: session } = await workspace.client.auth.getSession();
    const result = await callDisconnect(session.session!.access_token, workspace.workspaceId);
    expect(result.status).toBe(200);

    const { data: integration } = await admin.from("workspace_integrations").select("status, disconnected_at, vault_secret_id").eq("id", integrationId).single();
    expect(integration!.status).toBe("disconnected");
    expect(integration!.disconnected_at).toBeTruthy();
    expect(integration!.vault_secret_id).toBeNull();

    const { data: secret } = await admin.rpc("get_workspace_integration_secret", { p_integration_id: integrationId });
    expect(secret).toBeNull();

    // Instruction #17: disconnect must NOT delete historical content.
    const { data: page } = await admin.from("workspace_facebook_pages").select("page_name").eq("id", pageId).single();
    expect(page!.page_name).toBe("Historical Page");
  });
});

describe("Integrations manual resource refresh (release blocker)", () => {
  let workspace: TestTenant;
  let integrationId: string;
  let existingPageId: string;

  beforeAll(async () => {
    workspace = await createTestTenant("integrations-discover");
    integrationId = await seedWorkspaceIntegration(workspace.workspaceId);
    await admin.rpc("set_workspace_integration_secret", { p_integration_id: integrationId, p_secret: "mock-refresh-token" });
    // Pre-select one of the mock pages as ACTIVE, simulating an admin's
    // earlier explicit choice - a refresh must not silently deselect it.
    const { data } = await admin
      .from("workspace_facebook_pages")
      .insert({ workspace_id: workspace.workspaceId, integration_id: integrationId, page_id: "mock-page-acapolite", page_name: "Acapolite Consulting", is_active: true })
      .select("id")
      .single();
    existingPageId = data!.id;
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
  });

  it("refreshing resources (mock mode) discovers the fixture pages, leaves an already-active selection ACTIVE, and inserts newly-seen ones as inactive", async () => {
    const { data: session } = await workspace.client.auth.getSession();
    const result = await callDiscover(session.session!.access_token, workspace.workspaceId);
    expect(result.status).toBe(200);
    expect(result.body.summary.facebookPages.discovered).toBeGreaterThan(0);

    const { data: existing } = await admin.from("workspace_facebook_pages").select("is_active").eq("id", existingPageId).single();
    expect(existing!.is_active).toBe(true); // untouched by the refresh

    const { data: allPages } = await admin.from("workspace_facebook_pages").select("is_active").eq("workspace_id", workspace.workspaceId).neq("id", existingPageId);
    expect(allPages!.length).toBeGreaterThan(0);
    expect(allPages!.every((p) => p.is_active === false)).toBe(true); // newly discovered ones default inactive
  });
});

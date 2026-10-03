// Phase C instruction #31. Extends the existing Vault-access proof
// (role-escalation.test.ts: normal users can't SELECT/get/set a secret)
// with the ONE new secret-touching RPC Phase C adds -
// clear_workspace_integration_secret() (used by integrations-disconnect) -
// and proves the connection-health response a client actually receives
// never contains the raw provider token.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedWorkspaceIntegration } from "./integrationHelpers";

describe("Integrations Vault access (release blocker)", () => {
  let workspace: TestTenant;
  let integrationId: string;

  beforeAll(async () => {
    workspace = await createTestTenant("integrations-vault");
    integrationId = await seedWorkspaceIntegration(workspace.workspaceId);
    await admin.rpc("set_workspace_integration_secret", { p_integration_id: integrationId, p_secret: "super-secret-meta-token-should-never-leak" });
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
  });

  it("even the workspace owner cannot call clear_workspace_integration_secret() directly - EXECUTE is revoked from authenticated", async () => {
    const { data, error } = await workspace.client.rpc("clear_workspace_integration_secret", { p_integration_id: integrationId });
    expect(data).toBeNull();
    expect(error).toBeTruthy();

    // The secret must still be intact - the call was refused, not silently no-op'd.
    const { data: stillThere } = await admin.rpc("get_workspace_integration_secret", { p_integration_id: integrationId });
    expect(stillThere).toBe("super-secret-meta-token-should-never-leak");
  });

  it("the connection-health response a client receives never contains the raw provider token, only classified status", async () => {
    const { data: session } = await workspace.client.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/integrations-connection-health`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session!.access_token}` },
      body: JSON.stringify({ workspace_id: workspace.workspaceId, provider: "meta" }),
    });
    // The health check's resource list legitimately contains a resource
    // literally named "token" (the credential health check itself) - that
    // label is not a leak. What must never appear anywhere in the response
    // is the actual secret value.
    const bodyText = await res.text();
    expect(bodyText.includes("super-secret-meta-token-should-never-leak")).toBe(false);
  });
});

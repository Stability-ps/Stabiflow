// WhatsApp webhook subscription (inbound reliability).
//
// Proves, against the REAL edge functions, that:
//   - discovery/refresh (mock mode) records the WABA webhook subscription
//     on the integration WITHOUT any real Graph call
//   - integrations-connection-health reports the subscription state and
//     distinguishes subscribed / not-subscribed / unknown
//   - the explicit "repair" needs integration.manage (integration.view is
//     not enough), while a plain read-only check only needs integration.view
//   - workspace A cannot repair / read-check workspace B's integration
//   - no outbound WhatsApp message is ever sent
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, createTestUser, getTestEnv, seedMembership, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedWorkspaceIntegration, seedWhatsAppNumber } from "./integrationHelpers";

const TEST_HARNESS_SECRET = getTestEnv("INTEGRATIONS_TEST_HARNESS_SECRET");

async function callDiscover(token: string, workspaceId: string, body: Record<string, unknown>, harness: string | null = TEST_HARNESS_SECRET) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/integrations-discover-resources`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(harness ? { "x-stabiflow-test-harness": harness } : {}) },
    body: JSON.stringify({ provider: "whatsapp", ...body, workspace_id: workspaceId }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function callHealth(token: string, workspaceId: string, body: Record<string, unknown> = {}, harness: string | null = TEST_HARNESS_SECRET) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/integrations-connection-health`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(harness ? { "x-stabiflow-test-harness": harness } : {}) },
    body: JSON.stringify({ provider: "whatsapp", ...body, workspace_id: workspaceId }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function tokenFor(tenant: { client: import("@supabase/supabase-js").SupabaseClient }) {
  const { data } = await tenant.client.auth.getSession();
  return data.session!.access_token;
}

describe("WhatsApp webhook subscription (inbound reliability)", () => {
  let workspace: TestTenant;
  let other: TestTenant;
  let integrationId: string;
  let manager: { userId: string; client: import("@supabase/supabase-js").SupabaseClient };

  beforeAll(async () => {
    workspace = await createTestTenant("wa-webhook");
    other = await createTestTenant("wa-webhook-other");

    integrationId = await seedWorkspaceIntegration(workspace.workspaceId, "whatsapp");
    await admin.rpc("set_workspace_integration_secret", { p_integration_id: integrationId, p_secret: "mock-token-for-subscription-tests" });
    await seedWhatsAppNumber(workspace.workspaceId, integrationId, { waba_id: "waba-local-1", is_active: true });

    const managerUser = await createTestUser("wa-webhook-manager");
    await seedMembership(workspace.workspaceId, managerUser.userId, "manager"); // integration.view but NOT integration.manage
    manager = managerUser;
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
    await cleanupTenant(other);
    await cleanupTenant({ userId: manager.userId });
  });

  it("a mock-mode discovery refresh records the WABA webhook subscription as 'subscribed' on the integration - with NO real Graph API call", async () => {
    const token = await tokenFor(workspace);
    const result = await callDiscover(token, workspace.workspaceId, {});
    expect(result.status).toBe(200);
    expect(result.body?.summary?.whatsappWebhook?.status).toBe("subscribed");
    expect(String(result.body?.summary?.whatsappWebhook?.detail || "")).toMatch(/mock mode/i);

    const { data: integration } = await admin
      .from("workspace_integrations")
      .select("webhook_subscription_status, webhook_subscription_detail, webhook_subscription_checked_at")
      .eq("id", integrationId)
      .single();
    expect(integration!.webhook_subscription_status).toBe("subscribed");
    expect(integration!.webhook_subscription_checked_at).toBeTruthy();
    expect(String(integration!.webhook_subscription_detail || "")).toMatch(/mock mode/i);
  });

  it("connection-health reports the webhook state (subscribed) after discovery", async () => {
    const token = await tokenFor(workspace);
    const result = await callHealth(token, workspace.workspaceId, {});
    expect(result.status).toBe(200);
    expect(result.body?.integration?.webhook?.status).toBe("subscribed");
  });

  it("connection-health reports 'unknown' when the integration has NO discovered WABA yet (never a vacuous 'subscribed')", async () => {
    // A fresh workspace: whatsapp integration connected, but zero numbers.
    const bare = await createTestTenant("wa-webhook-bare");
    try {
      const bareIntegrationId = await seedWorkspaceIntegration(bare.workspaceId, "whatsapp");
      await admin.rpc("set_workspace_integration_secret", { p_integration_id: bareIntegrationId, p_secret: "mock-token" });
      const token = await tokenFor(bare);
      const result = await callHealth(token, bare.workspaceId, {});
      expect(result.status).toBe(200);
      // no active numbers -> resources empty -> webhook unknown, never 'subscribed'
      expect(["unknown", null]).toContain(result.body?.integration?.webhook?.status ?? null);
    } finally {
      await cleanupTenant(bare);
    }
  });

  it("the explicit repair (connection-health repair=true) REQUIRES integration.manage - a manager with only integration.view is refused", async () => {
    const managerToken = await tokenFor(manager);

    // A plain read-only check is allowed for integration.view...
    const plain = await callHealth(managerToken, workspace.workspaceId, {});
    expect(plain.status).toBe(200);

    // ...but repair=true is not.
    const repair = await callHealth(managerToken, workspace.workspaceId, { repair: true });
    expect(repair.status).toBe(403);
  });

  it("the owner CAN repair - it re-records 'subscribed' (mock mode, no Graph call)", async () => {
    const token = await tokenFor(workspace);
    const result = await callHealth(token, workspace.workspaceId, { repair: true });
    expect(result.status).toBe(200);
    expect(result.body?.integration?.webhook?.status).toBe("subscribed");
  });

  it("the repair_webhook fast-path on discover-resources also requires integration.manage (manager -> 403)", async () => {
    const managerToken = await tokenFor(manager);
    const result = await callDiscover(managerToken, workspace.workspaceId, { repair_webhook: true });
    expect(result.status).toBe(403);
  });

  it("the owner's repair_webhook fast-path records 'subscribed' without a full re-discovery", async () => {
    const token = await tokenFor(workspace);
    const result = await callDiscover(token, workspace.workspaceId, { repair_webhook: true });
    expect(result.status).toBe(200);
    expect(result.body?.webhookSubscription?.status).toBe("subscribed");
    expect(result.body?.summary).toBeUndefined(); // fast-path, not a full refresh
  });

  it("REGRESSION: workspace A's owner cannot repair or read-check workspace B's WhatsApp integration", async () => {
    const aToken = await tokenFor(workspace);
    // B has no membership for A's owner.
    const readB = await callHealth(aToken, other.workspaceId, {});
    expect(readB.status).toBe(403);
    const repairB = await callHealth(aToken, other.workspaceId, { repair: true });
    expect(repairB.status).toBe(403);
    const discoverB = await callDiscover(aToken, other.workspaceId, { repair_webhook: true });
    expect(discoverB.status).toBe(403);
  });

  it("no outbound WhatsApp message row was ever created by any of these calls", async () => {
    const { count } = await admin
      .from("inbox_messages")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.workspaceId)
      .eq("direction", "outbound");
    expect(count ?? 0).toBe(0);
  });
});

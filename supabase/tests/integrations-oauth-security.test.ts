// Phase C instruction #29/#30. Proves the OAuth start/callback pair
// against the REAL deployed edge functions (integrations-oauth-start,
// integrations-oauth-callback) - no mocks of the HTTP layer itself,
// though INTEGRATIONS_META_MOCK_MODE=true is set on this dev project so
// the happy-path test never calls the real Meta API (instruction #28).
//
// Every scenario here is a callback-security property that must hold
// REGARDLESS of what the browser/client claims: state validity, single-use
// replay protection, and re-verifying (at callback time, not just at
// start time) that the initiating user still belongs to the workspace
// with the required permission.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, createTestUser, seedMembership, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedOauthState } from "./integrationHelpers";

function callbackUrl(params: Record<string, string>) {
  const url = new URL(`${SUPABASE_URL}/functions/v1/integrations-oauth-callback`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

async function callCallback(params: Record<string, string>) {
  const res = await fetch(callbackUrl(params), { method: "GET", redirect: "manual" });
  const location = res.headers.get("location") || "";
  return { status: res.status, location, errorParam: new URL(location, "http://placeholder").searchParams.get("integration_error"), connectedParam: new URL(location, "http://placeholder").searchParams.get("integration_connected") };
}

async function callStart(token: string, workspaceId: string, provider: "meta" | "whatsapp" = "meta") {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/integrations-oauth-start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ workspace_id: workspaceId, provider }),
  });
  return { status: res.status, body: await res.json() };
}

describe("Integrations OAuth start (release blocker)", () => {
  let workspace: TestTenant;
  let viewer: { userId: string; client: import("@supabase/supabase-js").SupabaseClient };

  beforeAll(async () => {
    workspace = await createTestTenant("oauth-start");
    const viewerUser = await createTestUser("oauth-start-viewer");
    await seedMembership(workspace.workspaceId, viewerUser.userId, "viewer");
    viewer = viewerUser;
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
    await cleanupTenant({ userId: viewer.userId });
  });

  it("a viewer (no integration.connect) cannot start a Meta connection", async () => {
    const { data: session } = await viewer.client.auth.getSession();
    const result = await callStart(session.session!.access_token, workspace.workspaceId);
    expect(result.status).toBe(403);
  });

  it("the owner CAN start a connection and receives a URL carrying a state param", async () => {
    const { data: session } = await workspace.client.auth.getSession();
    const result = await callStart(session.session!.access_token, workspace.workspaceId);
    expect(result.status).toBe(200);
    const url = new URL(result.body.url);
    // This project runs with INTEGRATIONS_META_MOCK_MODE=true (no real Meta
    // App configured - instruction #28), so the returned url points at
    // StabiFlow's OWN callback with a fabricated code rather than
    // www.facebook.com/.../dialog/oauth - see integrations-oauth-start's
    // header comment. The state param is the property that matters either
    // way: it's what the callback's CSRF/replay protection is built on.
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.pathname.includes("integrations-oauth-callback")).toBe(true);
  });

  it("rejects an invalid provider value", async () => {
    const { data: session } = await workspace.client.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/integrations-oauth-start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session!.access_token}` },
      body: JSON.stringify({ workspace_id: workspace.workspaceId, provider: "google" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("Integrations OAuth callback security (release blocker)", () => {
  let workspace: TestTenant;
  let viewer: { userId: string; client: import("@supabase/supabase-js").SupabaseClient };
  let outsider: { userId: string };

  beforeAll(async () => {
    workspace = await createTestTenant("oauth-callback");
    const viewerUser = await createTestUser("oauth-callback-viewer");
    await seedMembership(workspace.workspaceId, viewerUser.userId, "viewer");
    viewer = viewerUser;
    outsider = await createTestUser("oauth-callback-outsider");
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
    await cleanupTenant({ userId: viewer.userId });
    await cleanupTenant({ userId: outsider.userId });
  });

  it("an unknown/forged state value is rejected as invalid_state", async () => {
    const result = await callCallback({ code: "irrelevant-code", state: "this-state-was-never-issued" });
    expect(result.status).toBe(302);
    expect(result.errorParam).toBe("invalid_state");
  });

  it("a request missing code or state is rejected before any state lookup", async () => {
    const result = await callCallback({ state: "some-state" }); // no code
    expect(result.errorParam).toBe("invalid_request");
  });

  it("an expired state (past its expires_at) is rejected as expired_state, even though it was never used", async () => {
    const state = await seedOauthState(workspace.workspaceId, workspace.userId, { expires_at: new Date(Date.now() - 60_000).toISOString() });
    const result = await callCallback({ code: "irrelevant-code", state });
    expect(result.errorParam).toBe("expired_state");
  });

  it("REGRESSION: a state row for a user who is NOT a member of that workspace is rejected as forbidden - the callback re-verifies membership, it does not trust the state row's mere existence", async () => {
    const state = await seedOauthState(workspace.workspaceId, outsider.userId);
    const result = await callCallback({ code: "irrelevant-code", state });
    expect(result.errorParam).toBe("forbidden");
  });

  it("a state row for a member who lacks integration.connect (viewer) is rejected as forbidden - the callback re-verifies the SPECIFIC permission, not just membership", async () => {
    const state = await seedOauthState(workspace.workspaceId, viewer.userId);
    const result = await callCallback({ code: "irrelevant-code", state });
    expect(result.errorParam).toBe("forbidden");
  });

  it("REGRESSION: a state value can never be used twice - replaying the exact same callback request the second time is rejected as invalid_state", async () => {
    const { data: session } = await workspace.client.auth.getSession();
    const start = await callStart(session.session!.access_token, workspace.workspaceId);
    const state = new URL(start.body.url).searchParams.get("state")!;

    const first = await callCallback({ code: "mock-code", state });
    expect(first.connectedParam).toBe("meta");

    const replay = await callCallback({ code: "mock-code", state });
    expect(replay.errorParam).toBe("invalid_state");
  });

  it("end-to-end (mock mode): a successful connect creates the integration row, stores a secret in Vault, and discovers resources as INACTIVE by default", async () => {
    const { data: session } = await workspace.client.auth.getSession();
    const start = await callStart(session.session!.access_token, workspace.workspaceId);
    const state = new URL(start.body.url).searchParams.get("state")!;

    const result = await callCallback({ code: "mock-code", state });
    expect(result.connectedParam).toBe("meta");

    const { data: integration } = await admin.from("workspace_integrations").select("id, status, vault_secret_id").eq("workspace_id", workspace.workspaceId).eq("provider", "meta").single();
    expect(integration!.status).toBe("connected");
    expect(integration!.vault_secret_id).toBeTruthy();

    const { data: secret } = await admin.rpc("get_workspace_integration_secret", { p_integration_id: integration!.id });
    expect(typeof secret).toBe("string");
    expect((secret as string).startsWith("mock-meta-token-")).toBe(true);

    const { data: pages } = await admin.from("workspace_facebook_pages").select("page_name, is_active").eq("workspace_id", workspace.workspaceId);
    expect(pages!.length).toBeGreaterThan(0);
    // Instruction #5: discovery never auto-activates a resource.
    expect(pages!.every((p) => p.is_active === false)).toBe(true);
  });
});

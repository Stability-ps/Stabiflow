// Launch-completion. Proves the platform-operator authorization model and
// workspace-suspension enforcement against the REAL deployed
// operator-workspaces function and the real status gates wired into
// flow-ai-chat/automations-tick/inbox-actions/ad-campaigns-*.
//
// NOTE (written but not run against a live deployment in this
// environment - see the accompanying report): this requires the
// 20260914060000_workspace_status_and_platform_operator.sql migration to
// be applied and operator-workspaces to be deployed first. Every helper
// call and assertion is written against the exact contracts defined in
// supabase/functions/operator-workspaces/index.ts and
// supabase/functions/_shared/workspaceStatus.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, createTestUser, SUPABASE_URL, type TestTenant } from "./helpers";

const OPERATOR_URL = `${SUPABASE_URL}/functions/v1/operator-workspaces`;
const FLOW_AI_URL = `${SUPABASE_URL}/functions/v1/flow-ai-chat`;

async function callOperator(token: string, body: Record<string, unknown>) {
  const res = await fetch(OPERATOR_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

describe("Platform operator authorization + workspace suspension (release blocker)", () => {
  let workspace: TestTenant;
  let otherWorkspace: TestTenant;
  let operatorUser: { userId: string; email: string; client: import("@supabase/supabase-js").SupabaseClient };
  let nonOperatorUser: { userId: string; email: string; client: import("@supabase/supabase-js").SupabaseClient };

  beforeAll(async () => {
    workspace = await createTestTenant("operator-suspend");
    otherWorkspace = await createTestTenant("operator-suspend-other");

    operatorUser = await createTestUser("operator-flag-holder");
    // No self-service way exists to set is_platform_operator - the only
    // writer is a direct service-role update, exactly as documented in
    // the migration/edge function comments. Legitimate here because this
    // is a disposable test identity, not a real account.
    await admin.from("profiles").update({ is_platform_operator: true }).eq("id", operatorUser.userId);

    nonOperatorUser = await createTestUser("operator-non-operator");
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
    await cleanupTenant(otherWorkspace);
    await admin.from("profiles").update({ is_platform_operator: false }).eq("id", operatorUser.userId);
    await cleanupTenant({ userId: operatorUser.userId });
    await cleanupTenant({ userId: nonOperatorUser.userId });
  });

  it("a non-operator cannot call any operator action", async () => {
    const { data: session } = await nonOperatorUser.client.auth.getSession();
    const result = await callOperator(session.session!.access_token, { action: "search_workspaces", query: "" });
    expect(result.status).toBe(403);
  });

  it("a workspace member cannot self-promote to operator via any client-reachable path (RLS blocks the write)", async () => {
    const { error } = await workspace.client.from("profiles").update({ is_platform_operator: true }).eq("id", workspace.userId);
    // No client UPDATE policy exists on profiles for is_platform_operator -
    // either the query errors, or it silently affects zero rows. Either
    // way, the flag must NOT actually flip.
    const { data: after } = await admin.from("profiles").select("is_platform_operator").eq("id", workspace.userId).single();
    expect(after!.is_platform_operator).toBe(false);
    void error;
  });

  it("operator can search and look up a workspace", async () => {
    const { data: session } = await operatorUser.client.auth.getSession();
    const token = session.session!.access_token;

    const search = await callOperator(token, { action: "search_workspaces", query: "" });
    expect(search.status).toBe(200);

    const detail = await callOperator(token, { action: "get_workspace", workspace_id: workspace.workspaceId });
    expect(detail.status).toBe(200);
    expect(detail.body.billing.status).toBe("trial");
  });

  it("suspend_workspace/unsuspend_workspace require a non-empty reason and are recorded in platform_operator_actions", async () => {
    const { data: session } = await operatorUser.client.auth.getSession();
    const token = session.session!.access_token;

    const missingReason = await callOperator(token, { action: "suspend_workspace", workspace_id: workspace.workspaceId, reason: "" });
    expect(missingReason.status).toBe(400);

    const suspend = await callOperator(token, { action: "suspend_workspace", workspace_id: workspace.workspaceId, reason: "release-blocker test" });
    expect(suspend.status).toBe(200);
    expect(suspend.body.status).toBe("suspended");

    const { data: logRow } = await admin.from("platform_operator_actions").select("action, reason, operator_user_id, workspace_id").eq("workspace_id", workspace.workspaceId).eq("action", "suspend_workspace").order("created_at", { ascending: false }).limit(1).single();
    expect(logRow!.operator_user_id).toBe(operatorUser.userId);
    expect(logRow!.reason).toBe("release-blocker test");

    const unsuspend = await callOperator(token, { action: "unsuspend_workspace", workspace_id: workspace.workspaceId, reason: "test cleanup" });
    expect(unsuspend.status).toBe(200);
    expect(unsuspend.body.status).toBe("active");
  });

  it("suspension cannot be bypassed by a direct table update from the workspace owner (protected by the workspace_billing_protect_status trigger)", async () => {
    const { error } = await workspace.client.from("workspace_billing").update({ status: "active" }).eq("workspace_id", workspace.workspaceId);
    expect(error).toBeTruthy();
  });

  it("suspending a workspace blocks Flow AI for THAT workspace only - reads and other workspaces remain unaffected", async () => {
    const { data: session } = await operatorUser.client.auth.getSession();
    const opToken = session.session!.access_token;
    await callOperator(opToken, { action: "suspend_workspace", workspace_id: workspace.workspaceId, reason: "cross-tenant isolation test" });

    const { data: ownerSession } = await workspace.client.auth.getSession();
    const flowAiResult = await fetch(FLOW_AI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerSession.session!.access_token}` },
      body: JSON.stringify({ workspaceId: workspace.workspaceId, message: "hello" }),
    });
    expect(flowAiResult.status).toBe(403);
    const flowAiBody = await flowAiResult.json();
    expect(flowAiBody.error).toBe("workspace_suspended");

    // Reads remain available - the workspace row itself and its own
    // members are still selectable under RLS regardless of status.
    const { error: readError } = await workspace.client.from("workspaces").select("id").eq("id", workspace.workspaceId).single();
    expect(readError).toBeNull();

    // Cross-tenant isolation: the OTHER workspace (never suspended, and
    // createTestTenant already made otherWorkspace.userId its owner) is
    // completely unaffected.
    const { data: otherSession } = await otherWorkspace.client.auth.getSession();
    const otherFlowAiResult = await fetch(FLOW_AI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${otherSession.session!.access_token}` },
      body: JSON.stringify({ workspaceId: otherWorkspace.workspaceId, message: "hello" }),
    });
    expect(otherFlowAiResult.status).not.toBe(403);

    await callOperator(opToken, { action: "unsuspend_workspace", workspace_id: workspace.workspaceId, reason: "test cleanup" });
  });
});

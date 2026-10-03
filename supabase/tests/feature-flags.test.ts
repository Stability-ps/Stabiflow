// Feature flags - LOCAL-Supabase integration tests. Covers every
// evaluation rule (kill switch, operator access, workspace target,
// everyone, operators-only, plan targeting, staged rollout) plus the
// launch posture (new workspaces see Business Studio only) and that
// clients can neither read targeting rows nor evaluate another tenant.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, createTestUser, seedMembership, type TestTenant } from "./helpers";

type Flag = { flag_key: string; enabled: boolean; reason: string };

async function flags(t: { client: TestTenant["client"] }, workspaceId: string): Promise<Record<string, Flag>> {
  const { data, error } = await t.client.rpc("evaluate_feature_flags", { p_workspace_id: workspaceId });
  if (error) throw new Error(error.message);
  return Object.fromEntries((data as Flag[]).map((f) => [f.flag_key, f]));
}

const TEST_FLAG = `test.flag_${Date.now()}`;

describe("Feature flags - evaluation rules and launch posture", () => {
  let A: TestTenant;
  let B: TestTenant;

  beforeAll(async () => {
    A = await createTestTenant("flags-a");
    B = await createTestTenant("flags-b");
    const { error } = await admin.from("feature_flags").insert({ key: TEST_FLAG, name: "Test flag", category: "experiment", audience: "targeted" });
    if (error) throw new Error(error.message);
  });

  afterAll(async () => {
    await admin.from("feature_flags").delete().eq("key", TEST_FLAG);
    await cleanupTenant(A);
    await cleanupTenant(B);
  });

  it("launch posture: a new workspace sees Business Studio but no advanced modules", async () => {
    const f = await flags(A, A.workspaceId);
    expect(f["module.business_studio"].enabled).toBe(true);
    for (const key of ["module.whatsapp", "module.leads", "module.campaigns", "module.creative_studio", "module.flow_ai", "module.automations"]) {
      expect(f[key].enabled).toBe(false);
    }
  });

  it("a workspace target enables a flag for that workspace only", async () => {
    await admin.from("feature_flag_workspace_targets").insert({ flag_key: TEST_FLAG, workspace_id: A.workspaceId, enabled: true, reason: "pilot" });
    expect((await flags(A, A.workspaceId))[TEST_FLAG]).toMatchObject({ enabled: true, reason: "workspace_target" });
    expect((await flags(B, B.workspaceId))[TEST_FLAG].enabled).toBe(false);
  });

  it("the global kill switch beats a workspace target", async () => {
    await admin.from("feature_flags").update({ is_enabled: false }).eq("key", TEST_FLAG);
    expect((await flags(A, A.workspaceId))[TEST_FLAG]).toMatchObject({ enabled: false, reason: "disabled" });
    await admin.from("feature_flags").update({ is_enabled: true }).eq("key", TEST_FLAG);
    await admin.from("feature_flag_workspace_targets").delete().eq("flag_key", TEST_FLAG);
  });

  it("audience everyone / operators-only", async () => {
    await admin.from("feature_flags").update({ audience: "everyone" }).eq("key", TEST_FLAG);
    expect((await flags(B, B.workspaceId))[TEST_FLAG].enabled).toBe(true);
    await admin.from("feature_flags").update({ audience: "operators" }).eq("key", TEST_FLAG);
    expect((await flags(B, B.workspaceId))[TEST_FLAG]).toMatchObject({ enabled: false, reason: "operators_only" });
  });

  it("a platform operator gets controlled access to enabled flags, not killed ones", async () => {
    const op = await createTestUser("flags-operator");
    await seedMembership(B.workspaceId, op.userId, "viewer");
    await admin.from("profiles").update({ is_platform_operator: true }).eq("id", op.userId);
    try {
      const f = await flags(op, B.workspaceId);
      expect(f[TEST_FLAG]).toMatchObject({ enabled: true, reason: "operator" });
      expect(f["module.whatsapp"].enabled).toBe(true);
      await admin.from("feature_flags").update({ is_enabled: false }).eq("key", TEST_FLAG);
      expect((await flags(op, B.workspaceId))[TEST_FLAG].enabled).toBe(false);
      await admin.from("feature_flags").update({ is_enabled: true }).eq("key", TEST_FLAG);
    } finally {
      await admin.from("profiles").update({ is_platform_operator: false }).eq("id", op.userId);
      await admin.from("workspace_members").delete().eq("workspace_id", B.workspaceId).eq("user_id", op.userId);
    }
  });

  it("plan targeting: holding the plan enables the flag", async () => {
    await admin.from("feature_flags").update({ audience: "targeted", plan_codes: ["business"] }).eq("key", TEST_FLAG);
    expect((await flags(A, A.workspaceId))[TEST_FLAG].enabled).toBe(false);
    const { data: plan } = await admin.from("billing_plans").select("id").eq("code", "business").single();
    const { data: sub } = await admin
      .from("workspace_subscriptions")
      .insert({ workspace_id: A.workspaceId, plan_id: plan!.id, status: "active", current_period_end: new Date(Date.now() + 86400000 * 10).toISOString() })
      .select("id")
      .single();
    expect((await flags(A, A.workspaceId))[TEST_FLAG]).toMatchObject({ enabled: true, reason: "plan" });
    await admin.from("workspace_subscriptions").delete().eq("id", sub!.id);
    await admin.from("feature_flags").update({ plan_codes: [] }).eq("key", TEST_FLAG);
  });

  it("paid plans unlock the modules advertised for their tier", async () => {
    const { data: business } = await admin.from("billing_plans").select("id").eq("code", "business").single();
    const { data: growth } = await admin.from("billing_plans").select("id").eq("code", "growth").single();

    const { data: businessSub } = await admin.from("workspace_subscriptions")
      .insert({ workspace_id: A.workspaceId, plan_id: business!.id, status: "active", current_period_end: new Date(Date.now() + 86400000 * 10).toISOString() })
      .select("id").single();
    let f = await flags(A, A.workspaceId);
    expect(f["module.content"]).toMatchObject({ enabled: true, reason: "plan" });
    expect(f["module.leads"]).toMatchObject({ enabled: true, reason: "plan" });
    expect(f["module.customers"]).toMatchObject({ enabled: true, reason: "plan" });
    expect(f["module.whatsapp"].enabled).toBe(false);
    await admin.from("workspace_subscriptions").delete().eq("id", businessSub!.id);

    const { data: growthSub } = await admin.from("workspace_subscriptions")
      .insert({ workspace_id: A.workspaceId, plan_id: growth!.id, status: "active", current_period_end: new Date(Date.now() + 86400000 * 10).toISOString() })
      .select("id").single();
    f = await flags(A, A.workspaceId);
    for (const key of ["module.content","module.leads","module.customers","module.whatsapp","module.campaigns","module.creative_studio","module.analytics","module.flow_ai","module.automations","module.integrations"]) {
      expect(f[key]).toMatchObject({ enabled: true, reason: "plan" });
    }
    await admin.from("workspace_subscriptions").delete().eq("id", growthSub!.id);
  });

  it("staged rollout: 0% off, 100% on, and a workspace's bucket is stable", async () => {
    await admin.from("feature_flags").update({ rollout_percentage: 0 }).eq("key", TEST_FLAG);
    expect((await flags(A, A.workspaceId))[TEST_FLAG].enabled).toBe(false);
    await admin.from("feature_flags").update({ rollout_percentage: 100 }).eq("key", TEST_FLAG);
    expect((await flags(A, A.workspaceId))[TEST_FLAG]).toMatchObject({ enabled: true, reason: "rollout" });

    const { data: b1 } = await admin.rpc("feature_flag_bucket", { p_flag_key: TEST_FLAG, p_workspace_id: A.workspaceId });
    const { data: b2 } = await admin.rpc("feature_flag_bucket", { p_flag_key: TEST_FLAG, p_workspace_id: A.workspaceId });
    expect(b1).toBe(b2);
    expect(b1).toBeGreaterThanOrEqual(0);
    expect(b1).toBeLessThan(100);
  });

  it("clients cannot evaluate another tenant's flags or read/write flag tables", async () => {
    const { error } = await A.client.rpc("evaluate_feature_flags", { p_workspace_id: B.workspaceId });
    expect(error).not.toBeNull();
    const { data: targets } = await A.client.from("feature_flag_workspace_targets").select("*");
    expect(targets).toEqual([]);
    const { error: insErr } = await A.client.from("feature_flag_workspace_targets").insert({ flag_key: "module.whatsapp", workspace_id: A.workspaceId, enabled: true, reason: "me" });
    expect(insErr).not.toBeNull();
    const { data: upd } = await A.client.from("feature_flags").update({ audience: "everyone" }).eq("key", "module.whatsapp").select();
    expect(upd ?? []).toEqual([]);
  });
});

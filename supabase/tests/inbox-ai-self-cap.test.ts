// 20261026060000_inbox_ai_self_cap. A workspace can only LOWER its WhatsApp
// Inbox AI monthly token cap; it can never raise the effective cap above its
// plan/platform cap, by RPC or by writing the setting directly. LOCAL
// Supabase, real RLS.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, createTestUser, seedMembership, type TestTenant } from "./helpers";

let ws: TestTenant;
let other: TestTenant;

async function setPlatformCap(workspaceId: string, cap: number | null) {
  const { data } = await admin.from("workspace_billing").select("limits").eq("workspace_id", workspaceId).maybeSingle();
  const limits = { ...((data?.limits as Record<string, unknown>) ?? {}) };
  if (cap == null) delete limits.whatsapp_inbox_ai_monthly_token_limit;
  else limits.whatsapp_inbox_ai_monthly_token_limit = cap;
  const { error } = await admin.from("workspace_billing").upsert({ workspace_id: workspaceId, limits }, { onConflict: "workspace_id" });
  if (error) throw new Error(error.message);
}

async function effective(client: TestTenant["client"], workspaceId: string) {
  const { data, error } = await client.rpc("workspace_ai_token_cap", { p_workspace_id: workspaceId, p_feature: "whatsapp_inbox_ai" });
  if (error) throw new Error(error.message);
  return Number(data);
}

beforeAll(async () => {
  ws = await createTestTenant("inbox-self-cap");
  other = await createTestTenant("inbox-self-cap-other");
});

afterAll(async () => {
  await cleanupTenant(ws);
  await cleanupTenant(other);
});

describe("WhatsApp Inbox AI cap: lower only", () => {
  it("an owner can set a cap below the plan cap and it takes effect", async () => {
    await setPlatformCap(ws.workspaceId, 20000);
    const { data, error } = await ws.client.rpc("set_workspace_inbox_ai_cap", { p_workspace_id: ws.workspaceId, p_cap: 5000 });
    expect(error).toBeNull();
    expect(Number(data)).toBe(5000);
    expect(await effective(ws.client, ws.workspaceId)).toBe(5000);
  });

  it("a cap above the plan cap is refused with the plan maximum, and nothing changes", async () => {
    const { error } = await ws.client.rpc("set_workspace_inbox_ai_cap", { p_workspace_id: ws.workspaceId, p_cap: 1_099_511_627_776 });
    expect(error?.code).toBe("22003");
    expect(error?.message).toMatch(/Your plan allows up to 20000 WhatsApp AI tokens a month/);
    expect(await effective(ws.client, ws.workspaceId)).toBe(5000);
  });

  it("a cap of zero or less is refused", async () => {
    const { error } = await ws.client.rpc("set_workspace_inbox_ai_cap", { p_workspace_id: ws.workspaceId, p_cap: 0 });
    expect(error?.code).toBe("22003");
  });

  it("clearing the cap returns to the plan cap, never above it", async () => {
    const { error } = await ws.client.rpc("set_workspace_inbox_ai_cap", { p_workspace_id: ws.workspaceId });
    expect(error).toBeNull();
    expect(await effective(ws.client, ws.workspaceId)).toBe(20000);
  });

  it("writing a huge cap straight into workspace_settings cannot raise the effective cap", async () => {
    const { error } = await ws.client.from("workspace_settings").update({ inbox_ai_monthly_token_self_cap: 1_000_000_000 }).eq("workspace_id", ws.workspaceId);
    expect(error).toBeNull();
    expect(await effective(ws.client, ws.workspaceId)).toBe(20000);
    await ws.client.rpc("set_workspace_inbox_ai_cap", { p_workspace_id: ws.workspaceId });
  });

  it("the workspace cannot change the platform cap itself", async () => {
    const { error } = await ws.client.from("workspace_billing").update({ limits: { whatsapp_inbox_ai_monthly_token_limit: 1_000_000_000 } }).eq("workspace_id", ws.workspaceId);
    expect(error).not.toBeNull();
    expect(await effective(ws.client, ws.workspaceId)).toBe(20000);
  });

  it("a downgrade (smaller plan/platform cap) is never undone by a stored self cap", async () => {
    await setPlatformCap(ws.workspaceId, 200000);
    await ws.client.rpc("set_workspace_inbox_ai_cap", { p_workspace_id: ws.workspaceId, p_cap: 150000 });
    expect(await effective(ws.client, ws.workspaceId)).toBe(150000);
    await setPlatformCap(ws.workspaceId, 50000);
    expect(await effective(ws.client, ws.workspaceId)).toBe(50000);
    const { data } = await ws.client.rpc("get_workspace_inbox_ai_cap", { p_workspace_id: ws.workspaceId });
    expect(data?.[0]).toMatchObject({ plan_cap: 50000, self_cap: 150000, effective_cap: 50000 });
  });

  it("the platform (service role) can still grant a larger cap", async () => {
    await ws.client.rpc("set_workspace_inbox_ai_cap", { p_workspace_id: ws.workspaceId });
    await setPlatformCap(ws.workspaceId, 900000);
    expect(await effective(ws.client, ws.workspaceId)).toBe(900000);
  });

  it("another workspace's owner can neither set nor read this workspace's cap", async () => {
    const { error: setError } = await other.client.rpc("set_workspace_inbox_ai_cap", { p_workspace_id: ws.workspaceId, p_cap: 1 });
    expect(setError?.code).toBe("42501");
    const { error: getError } = await other.client.rpc("get_workspace_inbox_ai_cap", { p_workspace_id: ws.workspaceId });
    expect(getError?.code).toBe("42501");
    expect(await effective(ws.client, ws.workspaceId)).toBe(900000);
  });

  it("a member without manage_billing cannot set the cap", async () => {
    await admin.from("workspace_entitlement_overrides").upsert({ workspace_id: ws.workspaceId, entitlement_key: "team_seats", limit_value: 5, reason: "self-cap test" }, { onConflict: "workspace_id,entitlement_key" });
    const sales = await createTestUser("inbox-self-cap-sales");
    await seedMembership(ws.workspaceId, sales.userId, "sales");
    const { error } = await sales.client.rpc("set_workspace_inbox_ai_cap", { p_workspace_id: ws.workspaceId, p_cap: 10 });
    expect(error?.code).toBe("42501");
  });
});

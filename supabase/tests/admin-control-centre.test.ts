// Admin Control Centre - roles, audit immutability and read models.
//
// Proves, against LOCAL Supabase with REAL RLS/grants:
//   * platform_admin_roles is invisible and unwritable to clients
//   * owner/admin roles (and only those) derive profiles.is_platform_operator,
//     and the derived flag still cannot be self-set by a client
//   * the last owner cannot be removed or demoted
//   * my_admin_role() returns only the caller's own role
//   * platform_admin_audit is append-only (no update/delete, even as service
//     role), except for the FK clearing workspace_id on workspace deletion
//   * every admin_* read model is service-role only and returns real rows
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestTenant, createTestUser, cleanupTenant, resetAdminRolesWithFixtureOwner, type TestTenant } from "./helpers";

type Identity = Awaited<ReturnType<typeof createTestUser>>;

async function operatorFlag(userId: string) {
  const { data, error } = await admin.from("profiles").select("is_platform_operator").eq("id", userId).single();
  if (error) throw new Error(error.message);
  return data.is_platform_operator as boolean;
}

let owner: Identity;
let staff: Identity;
let customer: Identity;
let tenant: TestTenant;
let fixtureOwnerId: string;

beforeAll(async () => {
  owner = await createTestUser("admin-owner");
  staff = await createTestUser("admin-staff");
  customer = await createTestUser("admin-customer");
  tenant = await createTestTenant("admin-tenant");
  fixtureOwnerId = await resetAdminRolesWithFixtureOwner();
});

afterAll(async () => {
  await resetAdminRolesWithFixtureOwner();
  await cleanupTenant(tenant);
});

describe("platform_admin_roles", () => {
  it("is not readable or writable by clients", async () => {
    const read = await customer.client.from("platform_admin_roles").select("*");
    expect(read.data ?? []).toEqual([]);
    const write = await customer.client.from("platform_admin_roles").insert({ user_id: customer.userId, role: "owner" });
    expect(write.error).toBeTruthy();
    expect(await operatorFlag(customer.userId)).toBe(false);
  });

  it("derives is_platform_operator for owner/admin only", async () => {
    expect((await admin.from("platform_admin_roles").insert({ user_id: owner.userId, role: "owner" })).error).toBeNull();
    expect(await operatorFlag(owner.userId)).toBe(true);

    expect((await admin.from("platform_admin_roles").insert({ user_id: staff.userId, role: "support" })).error).toBeNull();
    expect(await operatorFlag(staff.userId)).toBe(false);

    expect((await admin.from("platform_admin_roles").update({ role: "admin" }).eq("user_id", staff.userId)).error).toBeNull();
    expect(await operatorFlag(staff.userId)).toBe(true);

    expect((await admin.from("platform_admin_roles").update({ role: "analyst" }).eq("user_id", staff.userId)).error).toBeNull();
    expect(await operatorFlag(staff.userId)).toBe(false);
  });

  it("still blocks a client from self-setting the operator flag", async () => {
    const { error } = await customer.client.from("profiles").update({ is_platform_operator: true }).eq("id", customer.userId);
    expect(error).toBeTruthy();
    expect(await operatorFlag(customer.userId)).toBe(false);
  });

  it("my_admin_role() returns only the caller's role", async () => {
    const mine = await owner.client.rpc("my_admin_role");
    expect(mine.error).toBeNull();
    expect(mine.data).toBe("owner");
    const theirs = await customer.client.rpc("my_admin_role");
    expect(theirs.error).toBeNull();
    expect(theirs.data).toBeNull();
  });

  it("never removes or demotes the last owner", async () => {
    // Two owners: one may go. Then the remaining one cannot.
    expect((await admin.from("platform_admin_roles").delete().eq("user_id", owner.userId)).error).toBeNull();
    const { data: owners } = await admin.from("platform_admin_roles").select("user_id").eq("role", "owner");
    expect(owners).toEqual([{ user_id: fixtureOwnerId }]);
    const demote = await admin.from("platform_admin_roles").update({ role: "admin" }).eq("user_id", fixtureOwnerId);
    expect(demote.error?.message).toMatch(/last owner/i);
    const remove = await admin.from("platform_admin_roles").delete().eq("user_id", fixtureOwnerId);
    expect(remove.error?.message).toMatch(/last owner/i);
    // restore for later tests in this file
    await admin.from("platform_admin_roles").insert({ user_id: owner.userId, role: "owner" });
  });
});

describe("platform_admin_audit", () => {
  it("is append-only, but its workspace_id is cleared when the workspace is deleted", async () => {
    const extra = await createTestTenant("admin-audit-ws");
    const ins = await admin.from("platform_admin_audit")
      .insert({ operator_user_id: owner.userId, action: "test_action", target_type: "test", workspace_id: extra.workspaceId })
      .select("id").single();
    expect(ins.error).toBeNull();
    const id = ins.data!.id as string;

    const upd = await admin.from("platform_admin_audit").update({ reason: "tampered" }).eq("id", id);
    expect(upd.error?.message).toMatch(/append-only/);
    const del = await admin.from("platform_admin_audit").delete().eq("id", id);
    expect(del.error?.message).toMatch(/append-only/);

    await cleanupTenant(extra);
    const after = await admin.from("platform_admin_audit").select("workspace_id, action").eq("id", id).single();
    expect(after.data).toEqual({ workspace_id: null, action: "test_action" });
  });
});

describe("admin read models", () => {
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const to = new Date(now.getTime() + 60_000).toISOString();
  const calls: [string, Record<string, unknown>][] = [
    ["admin_overview", { p_from: from, p_to: to }],
    ["admin_attention_signals", {}],
    ["admin_activity_feed", { p_limit: 10 }],
    ["admin_users_page", { p_search: "", p_filter: "all", p_limit: 10, p_offset: 0 }],
    ["admin_workspaces_page", { p_search: "", p_filter: "all", p_limit: 10, p_offset: 0 }],
    ["admin_search", { p_q: "rls" }],
    ["admin_revenue", { p_from: from, p_to: to }],
    ["admin_staff", {}],
  ];

  it.each(calls)("%s is not executable by a signed-in customer", async (fn, args) => {
    const { error } = await customer.client.rpc(fn, args);
    expect(error).toBeTruthy();
  });

  it("admin_overview returns real counts for the range", async () => {
    const { data, error } = await admin.rpc("admin_overview", { p_from: from, p_to: to });
    expect(error).toBeNull();
    expect(data.workspaces.total).toBeGreaterThanOrEqual(1);
    expect(data.workspaces.new_in_range).toBeGreaterThanOrEqual(1);
    expect(data.series.length).toBeGreaterThanOrEqual(30);
    expect(data.revenue.by_currency).toEqual(expect.any(Array));
  });

  it("admin_overview counts enabled automations as active", async () => {
    const before = (await admin.rpc("admin_overview", { p_from: from, p_to: to })).data.product.automations_active;
    const ins = await admin.from("automations").insert({ workspace_id: tenant.workspaceId, name: "Admin count check", status: "enabled", trigger_event_type: "lead.created", created_by: tenant.userId }).select("id").single();
    expect(ins.error).toBeNull();
    const after = (await admin.rpc("admin_overview", { p_from: from, p_to: to })).data.product.automations_active;
    expect(after).toBe(before + 1);
    await admin.from("automations").delete().eq("id", ins.data!.id);
  });

  it("admin_overview rejects an inverted range", async () => {
    const { error } = await admin.rpc("admin_overview", { p_from: to, p_to: from });
    expect(error?.message).toMatch(/Invalid date range/);
  });

  it("admin_workspaces_page finds the tenant by name and reports its owner", async () => {
    const { data: ws } = await admin.from("workspaces").select("name").eq("id", tenant.workspaceId).single();
    const { data, error } = await admin.rpc("admin_workspaces_page", { p_search: ws!.name, p_filter: "all", p_limit: 10, p_offset: 0 });
    expect(error).toBeNull();
    const row = data.rows.find((r: { id: string }) => r.id === tenant.workspaceId);
    expect(row.owner.id).toBe(tenant.userId);
    expect(row.members).toBe(1);
    expect(row.paying).toBe(false);
  });

  it("admin_users_page treats LIKE wildcards literally", async () => {
    const { data, error } = await admin.rpc("admin_users_page", { p_search: "%", p_filter: "all", p_limit: 10, p_offset: 0 });
    expect(error).toBeNull();
    expect(data.rows.every((r: { email: string }) => r.email.includes("%"))).toBe(true);
  });

  it("detail models return null for unknown ids and full records for real ones", async () => {
    const missing = await admin.rpc("admin_workspace_detail", { p_workspace_id: "00000000-0000-0000-0000-000000000000" });
    expect(missing.data).toBeNull();
    const ws = await admin.rpc("admin_workspace_detail", { p_workspace_id: tenant.workspaceId });
    expect(ws.error).toBeNull();
    expect(ws.data.members[0].user_id).toBe(tenant.userId);
    expect(ws.data.modules).toHaveProperty("leads");
    expect(JSON.stringify(ws.data)).not.toMatch(/vault_secret_id|authorization_url|provider_email_token/);
    const user = await admin.rpc("admin_user_detail", { p_user_id: tenant.userId });
    expect(user.error).toBeNull();
    expect(user.data.workspaces.some((w: { id: string }) => w.id === tenant.workspaceId)).toBe(true);
  });

  it("admin_staff lists granted roles with emails", async () => {
    const { data, error } = await admin.rpc("admin_staff");
    expect(error).toBeNull();
    expect(data.some((r: { user_id: string; role: string }) => r.user_id === owner.userId && r.role === "owner")).toBe(true);
  });
});

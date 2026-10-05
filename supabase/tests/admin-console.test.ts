// Admin Control Centre edge functions - server-side role enforcement.
//
// Runs against LOCAL Supabase with `supabase functions serve` (or the local
// edge runtime). Proves that authorization lives in the functions, not the
// UI: unauthenticated -> 401, customers -> 403, and each staff role gets
// exactly what permissions.ts grants it - including on the legacy
// operator-admin / operator-workspaces endpoints. Also proves role changes
// and exports are audited, exports are real CSV, and nobody can change
// their own role.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, ANON_KEY, cleanupTenant, createTestTenant, createTestUser, resetAdminRolesWithFixtureOwner, SUPABASE_URL, type TestTenant } from "./helpers";

type Identity = Awaited<ReturnType<typeof createTestUser>>;

async function token(who: Identity | TestTenant) {
  const { data } = await who.client.auth.getSession();
  return data.session!.access_token;
}

async function call(fn: string, tok: string | null, body: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: JSON.stringify(body),
  });
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, type, disposition: res.headers.get("content-disposition"), body: type.includes("json") ? await res.json() : await res.text() };
}

let owner: Identity;
let analyst: Identity;
let support: Identity;
let marketing: Identity;
let customer: TestTenant;

beforeAll(async () => {
  owner = await createTestUser("console-owner");
  analyst = await createTestUser("console-analyst");
  support = await createTestUser("console-support");
  marketing = await createTestUser("console-marketing");
  customer = await createTestTenant("console-customer");
  await resetAdminRolesWithFixtureOwner();
  await admin.from("platform_admin_roles").upsert([
    { user_id: owner.userId, role: "owner" },
    { user_id: analyst.userId, role: "analyst" },
    { user_id: support.userId, role: "support" },
    { user_id: marketing.userId, role: "marketing" },
  ]);
});

afterAll(async () => {
  await resetAdminRolesWithFixtureOwner();
  await cleanupTenant(customer);
});

describe("admin-console authorization", () => {
  it("rejects anonymous callers and customers", async () => {
    expect((await call("admin-console", null, { action: "me" })).status).toBe(401);
    const res = await call("admin-console", await token(customer), { action: "overview" });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toMatch(/role|permission/i);
  });

  it("tells each staff member their own role and permissions", async () => {
    const res = await call("admin-console", await token(analyst), { action: "me" });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("analyst");
    expect(res.body.permissions).toContain("analytics.read");
    expect(res.body.permissions).not.toContain("users.read");
  });

  it("analyst sees aggregates but not the customer directory", async () => {
    const tok = await token(analyst);
    expect((await call("admin-console", tok, { action: "overview" })).status).toBe(200);
    expect((await call("admin-console", tok, { action: "attention" })).status).toBe(200);
    expect((await call("admin-console", tok, { action: "users" })).status).toBe(403);
    expect((await call("admin-console", tok, { action: "business", id: customer.workspaceId })).status).toBe(403);
    const search = await call("admin-console", tok, { action: "search", q: "rls" });
    expect(search.status).toBe(200);
    expect(search.body.users).toEqual([]);
    expect(search.body.workspaces).toEqual([]);
    expect((await call("admin-console", tok, { action: "export", dataset: "users" })).status).toBe(403);
    const activity = await call("admin-console", tok, { action: "activity", limit: 50 });
    expect(activity.status).toBe(200);
    expect(activity.body.rows.every((r: { workspace_name: string | null; workspace_id: string | null }) => r.workspace_name === null && r.workspace_id === null)).toBe(true);
    const attention = await call("admin-console", tok, { action: "attention" });
    expect(attention.body.alerts.every((a: { workspace: unknown }) => a.workspace === null)).toBe(true);
  });

  it("support can look a business up but cannot suspend it or manage staff", async () => {
    const tok = await token(support);
    const detail = await call("admin-console", tok, { action: "business", id: customer.workspaceId });
    expect(detail.status).toBe(200);
    expect(detail.body.data.members[0].user_id).toBe(customer.userId);
    expect((await call("operator-workspaces", tok, { action: "suspend_workspace", workspace_id: customer.workspaceId, reason: "test" })).status).toBe(403);
    expect((await call("admin-console", tok, { action: "grant_role", email: "x@example.com", role: "owner", reason: "test" })).status).toBe(403);
  });

  it("marketing can edit public copy but not operational billing settings or flags", async () => {
    const tok = await token(marketing);
    expect((await call("operator-admin", tok, { action: "update_setting", setting: { key: "billing.grace_days", value: 99 } })).status).toBe(403);
    expect((await call("operator-admin", tok, { action: "update_flag", key: "module.content", is_enabled: false, reason: "test" })).status).toBe(403);
    expect((await call("operator-admin", tok, { action: "list_settings" })).status).toBe(200);
  });

  it("rejects malformed input with a 400, never a raw database error", async () => {
    const tok = await token(owner);
    const bad = await call("admin-console", tok, { action: "overview", from: "2026-10-05", to: "2026-10-01" });
    expect(bad.status).toBe(400);
    expect((await call("admin-console", tok, { action: "user", id: "not-a-uuid" })).status).toBe(400);
    expect((await call("admin-console", tok, { action: "nope" })).status).toBe(400);
  });
});

describe("staff role management", () => {
  it("owner grants, changes and revokes a role, and each change is audited", async () => {
    const tok = await token(owner);
    const { data: user } = await admin.auth.admin.getUserById(customer.userId);
    const email = user.user!.email!;

    expect((await call("admin-console", tok, { action: "grant_role", email, role: "analyst", reason: "" })).status).toBe(400);
    const grant = await call("admin-console", tok, { action: "grant_role", email, role: "analyst", reason: "Quarterly review" });
    expect(grant.status).toBe(200);
    expect((await admin.from("platform_admin_roles").select("role").eq("user_id", customer.userId).single()).data?.role).toBe("analyst");

    expect((await call("admin-console", tok, { action: "grant_role", email, role: "support", reason: "Moved to support" })).status).toBe(200);
    expect((await call("admin-console", tok, { action: "revoke_role", user_id: customer.userId, reason: "Left the team" })).status).toBe(200);
    expect((await admin.from("platform_admin_roles").select("role").eq("user_id", customer.userId).maybeSingle()).data).toBeNull();

    const { data: audit } = await admin.from("platform_admin_audit").select("action, before_state, after_state, reason")
      .eq("target_type", "admin_role").eq("target_id", customer.userId).order("created_at", { ascending: false }).limit(3);
    expect(audit!.map((a) => a.action)).toEqual(["revoke_admin_role", "change_admin_role", "grant_admin_role"]);
    expect(audit![1]).toMatchObject({ before_state: { role: "analyst" }, after_state: { role: "support" } });
  });

  it("nobody can change their own role", async () => {
    const tok = await token(owner);
    const { data: user } = await admin.auth.admin.getUserById(owner.userId);
    const res = await call("admin-console", tok, { action: "grant_role", email: user.user!.email!, role: "analyst", reason: "Self demotion" });
    expect(res.status).toBe(400);
    expect((await call("admin-console", tok, { action: "revoke_role", user_id: owner.userId, reason: "Self removal" })).status).toBe(400);
  });
});

describe("exports", () => {
  it("returns a real, audited CSV download", async () => {
    const tok = await token(owner);
    const res = await call("admin-console", tok, { action: "export", dataset: "businesses", search: "RLS Test Workspace console-customer" });
    expect(res.status).toBe(200);
    expect(res.type).toContain("text/csv");
    expect(res.disposition).toMatch(/attachment; filename="stabiflow-businesses-\d{8}-\d{4}\.csv"/);
    const lines = (res.body as string).trim().split("\r\n");
    expect(lines[0]).toBe("Business ID,Name,Owner email,Status,Plans,Paying,Members,Country,Lifetime revenue,Created,Last activity");
    expect(lines.some((l) => l.startsWith(customer.workspaceId))).toBe(true);

    const { data: audit } = await admin.from("platform_admin_audit").select("after_state").eq("action", "export_data").eq("target_id", "businesses")
      .eq("operator_user_id", owner.userId).order("created_at", { ascending: false }).limit(1).single();
    expect(audit!.after_state.rows).toBe(lines.length - 1);
  });

  it("analyst may export aggregate AI usage", async () => {
    const res = await call("admin-console", await token(analyst), { action: "export", dataset: "ai_usage" });
    expect(res.status).toBe(200);
    expect((res.body as string).split("\r\n")[0]).toBe("Business,Feature,Model,Requests,Failed,Tokens,Estimated cost (USD)");
  });
});

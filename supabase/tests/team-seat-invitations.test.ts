// 20261027070000_fix_invitation_team_seat_check. Creating a pending
// invitation on a plan with a FINITE team_seats limit used to fail with
// 'record "new" has no field "user_id"' (the members-only check was planned
// for invitation rows too). Invitations must work, still count toward the
// seat limit, and an accepted invitation must not be double-counted.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, ANON_KEY, cleanupTenant, createTestTenant, createTestUser, grantAllowance, SUPABASE_URL, type TestTenant } from "./helpers";

let tenant: TestTenant;
const invite = (email: string) => admin.from("workspace_invitations").insert({
  workspace_id: tenant.workspaceId, email, role: "viewer", invited_by: tenant.userId, status: "pending",
  expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
}).select("id").single();

beforeAll(async () => {
  tenant = await createTestTenant("team-seat-invitations");
  await grantAllowance(tenant.workspaceId, "team_seats", 3); // owner + 2 seats
});
afterAll(async () => cleanupTenant(tenant));

describe("team seats and invitations", () => {
  it("a pending invitation can be created on a finite seat plan", async () => {
    const { data, error } = await invite(`seat-a-${Date.now()}@example.test`);
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });

  it("invitations still count toward the limit", async () => {
    expect((await invite(`seat-b-${Date.now()}@example.test`)).error).toBeNull();
    const { error } = await invite(`seat-c-${Date.now()}@example.test`);
    expect(error?.message).toMatch(/team-seat limit/);
  });
});

// Full invitation lifecycle on a real Business subscription (3 seats),
// through the same client path the app uses (Settings -> Members inserts
// with the inviter's session; acceptance via accept_workspace_invitation).
describe("Business-plan invitation lifecycle", () => {
  let biz: TestTenant;
  let rival: TestTenant;
  let subId: string;
  let a: { userId: string; email: string; client: import("@supabase/supabase-js").SupabaseClient };
  let b: { userId: string; email: string; client: import("@supabase/supabase-js").SupabaseClient };
  let c: { userId: string; email: string; client: import("@supabase/supabase-js").SupabaseClient };
  const tokens: Record<string, string> = {};
  const ownerInvite = (email: string, role = "viewer") => biz.client.from("workspace_invitations")
    .insert({ workspace_id: biz.workspaceId, email: email.toLowerCase(), role, invited_by: biz.userId })
    .select("id, token").single();

  beforeAll(async () => {
    biz = await createTestTenant("invite-business");
    rival = await createTestTenant("invite-rival");
    const { data: plan } = await admin.from("billing_plans").select("id").eq("code", "business").single();
    const { data: sub, error } = await admin.from("workspace_subscriptions")
      .insert({ workspace_id: biz.workspaceId, plan_id: plan!.id, status: "active", current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString() })
      .select("id").single();
    if (error) throw new Error(error.message);
    subId = sub!.id;
    a = await createTestUser("invitee-a");
    b = await createTestUser("invitee-b");
    c = await createTestUser("invitee-c");
  });
  afterAll(async () => {
    await admin.from("workspace_subscriptions").delete().eq("id", subId);
    await cleanupTenant(biz);
    await cleanupTenant(rival);
  });

  it("the plan really is Business with 3 seats", async () => {
    const { data } = await biz.client.rpc("get_workspace_entitlements", { p_workspace_id: biz.workspaceId });
    const seats = (data as Array<{ entitlement_key: string; limit_value: number }>).find((e) => e.entitlement_key === "team_seats");
    expect(seats?.limit_value).toBe(3);
  });

  it("the owner can invite while seats are available", async () => {
    const r1 = await ownerInvite(a.email, "viewer");
    expect(r1.error).toBeNull();
    tokens.a = r1.data!.token;
    const r2 = await ownerInvite(b.email, "admin");
    expect(r2.error).toBeNull();
    tokens.b = r2.data!.token;
  });

  it("a duplicate pending invitation for the same email is refused (23505)", async () => {
    const { error } = await ownerInvite(a.email);
    expect(error?.code).toBe("23505");
  });

  it("a fully occupied plan refuses another invitation", async () => {
    // owner (1 member) + 2 pending = 3 of 3
    const { error } = await ownerInvite(c.email);
    expect(error?.message).toMatch(/team-seat limit/);
  });

  it("an expired invitation frees its seat and can no longer be accepted", async () => {
    await admin.from("workspace_invitations").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("token", tokens.b);
    const { error: acceptErr } = await b.client.rpc("accept_workspace_invitation", { p_token: tokens.b });
    expect(acceptErr?.message).toMatch(/expired/);
    const r = await ownerInvite(c.email, "viewer");
    expect(r.error).toBeNull();
    tokens.c = r.data!.token;
  });

  it("only the invited email can accept, with exactly the invited role", async () => {
    const wrong = await c.client.rpc("accept_workspace_invitation", { p_token: tokens.a });
    expect(wrong.error?.message).toMatch(/different email/);
    const ok = await a.client.rpc("accept_workspace_invitation", { p_token: tokens.a });
    expect(ok.error).toBeNull();
    const { data: m } = await admin.from("workspace_members").select("role").eq("workspace_id", biz.workspaceId).eq("user_id", a.userId).single();
    expect(m?.role).toBe("viewer");
  });

  it("accepting converts a counted seat instead of double-counting it", async () => {
    // owner + a (members) + c (pending) = 3 of 3: c can still accept.
    const { error } = await c.client.rpc("accept_workspace_invitation", { p_token: tokens.c });
    expect(error).toBeNull();
    const { count } = await admin.from("workspace_members").select("id", { count: "exact", head: true }).eq("workspace_id", biz.workspaceId);
    expect(count).toBe(3);
  });

  it("a viewer cannot invite (role permissions)", async () => {
    const { error } = await a.client.from("workspace_invitations")
      .insert({ workspace_id: biz.workspaceId, email: "nope@example.test", role: "viewer", invited_by: a.userId });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("another workspace's owner cannot invite into this workspace (isolation)", async () => {
    const { error } = await rival.client.from("workspace_invitations")
      .insert({ workspace_id: biz.workspaceId, email: "intruder@example.test", role: "admin", invited_by: rival.userId });
    expect(error).not.toBeNull();
    const { data } = await rival.client.from("workspace_invitations").select("id").eq("workspace_id", biz.workspaceId);
    expect(data ?? []).toEqual([]);
  });

  it("an anonymous caller cannot invite", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { error } = await anon.from("workspace_invitations")
      .insert({ workspace_id: biz.workspaceId, email: "anon@example.test", role: "viewer", invited_by: biz.userId });
    expect(error).not.toBeNull();
  });
});

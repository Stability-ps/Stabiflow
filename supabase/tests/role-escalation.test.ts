// Phase 4 security hardening tests. These exist because the audit found a
// real gap: the original workspace_members_update_admin /
// workspace_invitations_insert_admin policies only checked "is the caller
// an admin of this workspace," never "does the caller outrank the role
// being granted or the member being modified." Migration
// 20260825060000_prevent_role_escalation.sql closed it via
// can_manage_member_with_role()/can_grant_workspace_role(); these tests
// prove the fix against the real, live project, and would fail against
// the pre-migration policies.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, createTestUser, seedMembership, type TestTenant } from "./helpers";

let owner: TestTenant; // owner of workspace A
let adminUser: { userId: string; email: string; client: import("@supabase/supabase-js").SupabaseClient };
let admin2: { userId: string; email: string; client: import("@supabase/supabase-js").SupabaseClient };
let marketingUser: { userId: string; email: string; client: import("@supabase/supabase-js").SupabaseClient };
let outsider: { userId: string; email: string; client: import("@supabase/supabase-js").SupabaseClient }; // belongs to no workspace at all
let otherOwner: TestTenant; // owner of an unrelated workspace B, for cross-workspace invitation tests

beforeAll(async () => {
  owner = await createTestTenant("owner");
  otherOwner = await createTestTenant("other-owner");

  adminUser = await createTestUser("admin");
  admin2 = await createTestUser("admin2");
  marketingUser = await createTestUser("marketing");
  outsider = await createTestUser("outsider");

  await seedMembership(owner.workspaceId, adminUser.userId, "admin");
  await seedMembership(owner.workspaceId, admin2.userId, "admin");
  await seedMembership(owner.workspaceId, marketingUser.userId, "marketing");
});

afterAll(async () => {
  // Deleting owner/otherOwner's workspaces cascades away the
  // adminUser/admin2/marketingUser membership rows seeded into
  // owner.workspaceId too - adminUser/admin2/marketingUser/outsider are
  // pooled identities (see helpers.ts) with no workspace of their own to
  // clean up, and are never deleted themselves (shared fixtures).
  await cleanupTenant(owner);
  await cleanupTenant(otherOwner);
});

async function currentRole(workspaceId: string, userId: string): Promise<string | null> {
  const { data } = await admin.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  return data?.role ?? null;
}

describe("Admin cannot promote themselves to Owner", () => {
  it("a direct UPDATE of their own row to role=owner affects 0 rows", async () => {
    const { data } = await adminUser.client
      .from("workspace_members")
      .update({ role: "owner" })
      .eq("workspace_id", owner.workspaceId)
      .eq("user_id", adminUser.userId)
      .select();
    expect(data ?? []).toEqual([]);
    expect(await currentRole(owner.workspaceId, adminUser.userId)).toBe("admin");
  });

  it("an admin cannot promote a PEER admin to owner either", async () => {
    const { data } = await adminUser.client
      .from("workspace_members")
      .update({ role: "owner" })
      .eq("workspace_id", owner.workspaceId)
      .eq("user_id", admin2.userId)
      .select();
    expect(data ?? []).toEqual([]);
    expect(await currentRole(owner.workspaceId, admin2.userId)).toBe("admin");
  });

  it("the actual owner CAN still manage a subordinate member's role (the fix isn't over-broad)", async () => {
    const { data } = await owner.client
      .from("workspace_members")
      .update({ role: "sales" })
      .eq("workspace_id", owner.workspaceId)
      .eq("user_id", marketingUser.userId)
      .select();
    expect(data?.length).toBe(1);
    expect(await currentRole(owner.workspaceId, marketingUser.userId)).toBe("sales");
    // restore for later tests
    await admin.from("workspace_members").update({ role: "marketing" }).eq("workspace_id", owner.workspaceId).eq("user_id", marketingUser.userId);
  });
});

describe("Lower roles cannot assign roles above their authority", () => {
  it("an admin CAN adjust a lower-ranked member's role to another lower rank", async () => {
    const { data } = await adminUser.client
      .from("workspace_members")
      .update({ role: "support" })
      .eq("workspace_id", owner.workspaceId)
      .eq("user_id", marketingUser.userId)
      .select();
    expect(data?.length).toBe(1);
    await admin.from("workspace_members").update({ role: "marketing" }).eq("workspace_id", owner.workspaceId).eq("user_id", marketingUser.userId);
  });

  it("a marketing-role member (not admin+) cannot change ANYONE's role, including their own", async () => {
    const { data } = await marketingUser.client
      .from("workspace_members")
      .update({ role: "sales" })
      .eq("workspace_id", owner.workspaceId)
      .eq("user_id", marketingUser.userId)
      .select();
    expect(data ?? []).toEqual([]);
    expect(await currentRole(owner.workspaceId, marketingUser.userId)).toBe("marketing");
  });

  it("a marketing-role member cannot DELETE another member", async () => {
    await marketingUser.client.from("workspace_members").delete().eq("workspace_id", owner.workspaceId).eq("user_id", adminUser.userId);
    expect(await currentRole(owner.workspaceId, adminUser.userId)).toBe("admin");
  });

  it("an admin cannot DELETE another admin or the owner", async () => {
    await adminUser.client.from("workspace_members").delete().eq("workspace_id", owner.workspaceId).eq("user_id", admin2.userId);
    expect(await currentRole(owner.workspaceId, admin2.userId)).toBe("admin");

    await adminUser.client.from("workspace_members").delete().eq("workspace_id", owner.workspaceId).eq("user_id", owner.userId);
    expect(await currentRole(owner.workspaceId, owner.userId)).toBe("owner");
  });
});

describe("Invitations cannot grant unauthorized roles or cross into unauthorized workspaces", () => {
  it("an admin cannot CREATE an invitation offering the owner role", async () => {
    const { error } = await adminUser.client
      .from("workspace_invitations")
      .insert({ workspace_id: owner.workspaceId, email: "wannabe-owner@example.com", role: "owner", invited_by: adminUser.userId });
    expect(error).not.toBeNull();
  });

  it("the actual owner CAN create an invitation offering the owner role (legitimate transfer/co-owner path)", async () => {
    const { error } = await owner.client
      .from("workspace_invitations")
      .insert({ workspace_id: owner.workspaceId, email: "co-owner@example.com", role: "owner", invited_by: owner.userId });
    expect(error).toBeNull();
    await admin.from("workspace_invitations").delete().eq("workspace_id", owner.workspaceId).eq("email", "co-owner@example.com");
  });

  it("an admin of workspace A cannot create ANY invitation for workspace B, which they have no membership in at all", async () => {
    const { error } = await adminUser.client
      .from("workspace_invitations")
      .insert({ workspace_id: otherOwner.workspaceId, email: "cross-tenant@example.com", role: "viewer", invited_by: adminUser.userId });
    expect(error).not.toBeNull();
  });

  it("an invitation can only be accepted by the email address it was sent to", async () => {
    const { data: invitation } = await admin
      .from("workspace_invitations")
      .insert({ workspace_id: otherOwner.workspaceId, email: "someone-specific@example.com", role: "viewer", invited_by: otherOwner.userId })
      .select("token")
      .single();

    // outsider's email does NOT match "someone-specific@example.com"
    const { error } = await outsider.client.rpc("accept_workspace_invitation", { p_token: invitation!.token });
    expect(error).not.toBeNull();
    expect(await currentRole(otherOwner.workspaceId, outsider.userId)).toBeNull();
  });

  it("an owner-role invitation is rejected at accept time if the inviter no longer holds owner", async () => {
    // Seed a second owner-eligible inviter scenario: admin2 briefly "becomes"
    // owner via service role (simulating a legitimate prior transfer), issues
    // an owner invitation, then is demoted back to admin before it's accepted.
    await admin.from("workspace_members").update({ role: "owner" }).eq("workspace_id", owner.workspaceId).eq("user_id", admin2.userId);

    const { data: invitation } = await admin
      .from("workspace_invitations")
      .insert({ workspace_id: owner.workspaceId, email: outsider.email, role: "owner", invited_by: admin2.userId })
      .select("token")
      .single();

    // Inviter's ownership is revoked before the invite is accepted.
    await admin.from("workspace_members").update({ role: "admin" }).eq("workspace_id", owner.workspaceId).eq("user_id", admin2.userId);

    const { error } = await outsider.client.rpc("accept_workspace_invitation", { p_token: invitation!.token });
    expect(error).not.toBeNull();
    expect(await currentRole(owner.workspaceId, outsider.userId)).toBeNull();
  });
});

describe("Membership RPCs cannot be abused to join arbitrary workspaces", () => {
  it("create_workspace() always creates a brand-new workspace - it accepts no existing-workspace id at all", async () => {
    const before = await currentRole(otherOwner.workspaceId, outsider.userId);
    expect(before).toBeNull();
    // create_workspace's signature (name, slug) has no parameter through
    // which an existing workspace could be targeted - this is a
    // structural guarantee, demonstrated here by confirming outsider
    // still has no membership in otherOwner's workspace afterward.
    const { data: newWorkspaceId, error } = await outsider.client.rpc("create_workspace", {
      p_name: "Outsider's Own Workspace",
      p_slug: `outsider-own-${Date.now()}`,
    });
    expect(error).toBeNull();
    expect(newWorkspaceId).not.toBe(otherOwner.workspaceId);
    expect(await currentRole(otherOwner.workspaceId, outsider.userId)).toBeNull();
    if (newWorkspaceId) await admin.from("workspaces").delete().eq("id", newWorkspaceId as string);
  });

  it("accept_workspace_invitation() with a random/nonexistent token fails, not silently joins nothing", async () => {
    const { error } = await outsider.client.rpc("accept_workspace_invitation", { p_token: "00000000-0000-0000-0000-000000000000" });
    expect(error).not.toBeNull();
  });

  it("there is no direct INSERT path into workspace_members at all - it can only be reached via the two RPCs", async () => {
    const { error } = await outsider.client
      .from("workspace_members")
      .insert({ workspace_id: otherOwner.workspaceId, user_id: outsider.userId, role: "owner" });
    expect(error).not.toBeNull();
    expect(await currentRole(otherOwner.workspaceId, outsider.userId)).toBeNull();
  });
});

describe("Normal authenticated users cannot access integration secrets", () => {
  it("even an admin-role member cannot read a decrypted secret via the client API", async () => {
    const { data: integration } = await admin
      .from("workspace_integrations")
      .insert({ workspace_id: owner.workspaceId, provider: "meta" })
      .select("id")
      .single();
    await admin.rpc("set_workspace_integration_secret", { p_integration_id: integration!.id, p_secret: "super-secret-meta-token" });

    const { data, error } = await adminUser.client.rpc("get_workspace_integration_secret", { p_integration_id: integration!.id });
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("even the workspace owner cannot WRITE a secret via the client API", async () => {
    const { data: integration } = await admin
      .from("workspace_integrations")
      .insert({ workspace_id: owner.workspaceId, provider: "whatsapp" })
      .select("id")
      .single();
    const { error } = await owner.client.rpc("set_workspace_integration_secret", { p_integration_id: integration!.id, p_secret: "attempted-write" });
    expect(error).not.toBeNull();
  });
});

// 20261027070000_fix_invitation_team_seat_check. Creating a pending
// invitation on a plan with a FINITE team_seats limit used to fail with
// 'record "new" has no field "user_id"' (the members-only check was planned
// for invitation rows too). Invitations must work, still count toward the
// seat limit, and an accepted invitation must not be double-counted.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, grantAllowance, type TestTenant } from "./helpers";

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

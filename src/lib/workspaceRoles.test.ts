// Unit tests for the CLIENT-SIDE mirror of can_grant_workspace_role() /
// can_manage_member_with_role() (20260825060000_prevent_role_escalation.sql).
// These predicates gate what the Members UI even offers - the database is
// the real security boundary, but a UI that offers a control the backend
// will reject is a broken UX, so this mirror must stay behaviorally
// identical to the SQL predicates it mimics.
import { describe, it, expect } from "vitest";
import { canGrantRole, canManageMemberWithRole, workspaceRoleRank, WORKSPACE_ROLES } from "./workspaceRoles";

describe("workspaceRoleRank", () => {
  it("ranks owner highest and viewer lowest", () => {
    expect(workspaceRoleRank("owner")).toBeGreaterThan(workspaceRoleRank("admin"));
    expect(workspaceRoleRank("admin")).toBeGreaterThan(workspaceRoleRank("manager"));
    expect(workspaceRoleRank("manager")).toBeGreaterThan(workspaceRoleRank("viewer"));
  });

  it("treats marketing/sales/support as rank-peers", () => {
    expect(workspaceRoleRank("marketing")).toBe(workspaceRoleRank("sales"));
    expect(workspaceRoleRank("sales")).toBe(workspaceRoleRank("support"));
  });

  it("returns 0 for a missing role, never throwing", () => {
    expect(workspaceRoleRank(null)).toBe(0);
    expect(workspaceRoleRank(undefined)).toBe(0);
  });
});

describe("canGrantRole", () => {
  it("a non-admin (manager and below) can never grant any role", () => {
    for (const role of WORKSPACE_ROLES) {
      expect(canGrantRole("manager", role)).toBe(false);
      expect(canGrantRole("viewer", role)).toBe(false);
    }
  });

  it("an admin can grant roles at or below admin, but never owner", () => {
    expect(canGrantRole("admin", "admin")).toBe(true);
    expect(canGrantRole("admin", "manager")).toBe(true);
    expect(canGrantRole("admin", "viewer")).toBe(true);
    expect(canGrantRole("admin", "owner")).toBe(false);
  });

  it("REGRESSION: only an existing owner can grant the owner role", () => {
    expect(canGrantRole("owner", "owner")).toBe(true);
    expect(canGrantRole("admin", "owner")).toBe(false);
  });

  it("a caller with no role at all can never grant anything", () => {
    expect(canGrantRole(null, "viewer")).toBe(false);
    expect(canGrantRole(undefined, "viewer")).toBe(false);
  });
});

describe("canManageMemberWithRole", () => {
  it("REGRESSION: a caller can never manage a member of their own rank, including themselves", () => {
    expect(canManageMemberWithRole("admin", "admin")).toBe(false);
    expect(canManageMemberWithRole("owner", "owner")).toBe(false);
    expect(canManageMemberWithRole("marketing", "sales")).toBe(false); // rank-peers
  });

  it("an admin can manage anyone strictly below admin rank", () => {
    expect(canManageMemberWithRole("admin", "manager")).toBe(true);
    expect(canManageMemberWithRole("admin", "viewer")).toBe(true);
  });

  it("an owner can manage an admin, but a non-admin caller can never manage anyone", () => {
    expect(canManageMemberWithRole("owner", "admin")).toBe(true);
    expect(canManageMemberWithRole("manager", "viewer")).toBe(false);
  });

  it("no one can manage an owner - there is currently no path to demote/remove an owner", () => {
    for (const role of WORKSPACE_ROLES) {
      expect(canManageMemberWithRole(role, "owner")).toBe(false);
    }
  });
});

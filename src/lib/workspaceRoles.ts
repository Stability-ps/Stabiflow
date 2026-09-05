import type { Tables } from "@/integrations/supabase/types";

export type WorkspaceRole = Tables<"workspace_members">["role"];

// Client-side MIRROR of workspace_role_rank() / can_grant_workspace_role() /
// can_manage_member_with_role() (20260824060200 + 20260825060000). UX-only:
// used to decide which roles a form offers, never the actual security
// boundary - the database re-checks the identical rule in RLS regardless
// of what this returns.
export const WORKSPACE_ROLES: WorkspaceRole[] = ["owner", "admin", "manager", "marketing", "sales", "support", "viewer"];

const ROLE_RANK: Record<WorkspaceRole, number> = {
  owner: 100,
  admin: 90,
  manager: 70,
  marketing: 50,
  sales: 50,
  support: 50,
  viewer: 10,
};

export function workspaceRoleRank(role: WorkspaceRole | null | undefined): number {
  return role ? ROLE_RANK[role] : 0;
}

// Mirrors can_grant_workspace_role(): caller must be admin+, at least as
// senior as the role being granted, and 'owner' can only be granted by an
// existing owner.
export function canGrantRole(callerRole: WorkspaceRole | null | undefined, newRole: WorkspaceRole): boolean {
  if (!callerRole) return false;
  if (workspaceRoleRank(callerRole) < workspaceRoleRank("admin")) return false;
  if (workspaceRoleRank(callerRole) < workspaceRoleRank(newRole)) return false;
  if (newRole === "owner" && callerRole !== "owner") return false;
  return true;
}

// Mirrors can_manage_member_with_role(): caller must be admin+ AND
// strictly outrank the role the target member CURRENTLY holds - so a
// caller can never touch a peer or senior, including their own row.
export function canManageMemberWithRole(callerRole: WorkspaceRole | null | undefined, currentRole: WorkspaceRole): boolean {
  if (!callerRole) return false;
  if (workspaceRoleRank(callerRole) < workspaceRoleRank("admin")) return false;
  return workspaceRoleRank(callerRole) > workspaceRoleRank(currentRole);
}

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  marketing: "Marketing",
  sales: "Sales",
  support: "Support",
  viewer: "Viewer",
};

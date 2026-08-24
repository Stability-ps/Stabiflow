// Client-side MIRROR of workspace_role_permissions
// (supabase/migrations/20260824060200_workspace_authorization_helpers.sql).
// UX-only: used to hide/show controls a role can't use, never to decide
// whether an action is actually allowed. Every RLS policy and RPC
// re-checks has_workspace_role()/has_workspace_permission() independently
// in the database - if this file drifted out of sync or were bypassed
// entirely, the backend would still refuse the action. Do not use this as
// a substitute for has_workspace_role() rank checks either: marketing,
// sales, and support are peers in the role hierarchy, so differentiating
// what each can do must go through permission names, not rank.
export type WorkspaceRole = "owner" | "admin" | "manager" | "marketing" | "sales" | "support" | "viewer";

export type WorkspacePermission =
  | "manage_workspace"
  | "manage_members"
  | "manage_billing"
  | "manage_integrations"
  | "manage_content"
  | "manage_campaigns"
  | "manage_inbox"
  | "manage_leads"
  | "manage_pipelines"
  | "view_analytics";

const PERMISSION_MATRIX: Record<WorkspaceRole, WorkspacePermission[]> = {
  owner: [
    "manage_workspace", "manage_members", "manage_billing", "manage_integrations",
    "manage_content", "manage_campaigns", "manage_inbox", "manage_leads", "manage_pipelines", "view_analytics",
  ],
  admin: [
    "manage_members", "manage_integrations", "manage_content", "manage_campaigns",
    "manage_inbox", "manage_leads", "manage_pipelines", "view_analytics",
  ],
  manager: ["manage_content", "manage_campaigns", "manage_inbox", "manage_leads", "manage_pipelines", "view_analytics"],
  marketing: ["manage_content", "manage_campaigns", "view_analytics"],
  sales: ["manage_leads", "view_analytics"],
  support: ["manage_inbox", "manage_leads"],
  viewer: ["view_analytics"],
};

export function roleHasPermission(role: WorkspaceRole | null | undefined, permission: WorkspacePermission): boolean {
  if (!role) return false;
  return PERMISSION_MATRIX[role]?.includes(permission) ?? false;
}

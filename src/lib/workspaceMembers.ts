import { supabase } from "@/integrations/supabase/client";
import type { WorkspaceRole } from "@/lib/workspaceRoles";

// Every write here is RLS-gated identically to what it attempts (see
// 20260824060300_workspace_core_rls.sql + 20260825060000_prevent_role_escalation.sql):
// can_grant_workspace_role() for invites/role-changes,
// can_manage_member_with_role() for role-changes/removal. This module does
// no authorization of its own - a rejected write surfaces as a normal
// Postgres/PostgREST error, translated to a readable message below.

function friendlyRlsError(error: { message: string; code?: string }, fallback: string): Error {
  // RLS violations from PostgREST come back as a generic "new row violates
  // row-level security policy" / 42501 - translate to something a workspace
  // admin can actually act on, without leaking policy internals.
  if (error.code === "42501" || /row-level security/i.test(error.message)) {
    return new Error(fallback);
  }
  return new Error(error.message);
}

export async function inviteMember(workspaceId: string, email: string, role: WorkspaceRole, invitedBy: string): Promise<string> {
  const { data, error } = await supabase
    .from("workspace_invitations")
    .insert({ workspace_id: workspaceId, email: email.trim().toLowerCase(), role, invited_by: invitedBy })
    .select("token")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("There's already a pending invitation for this email address.");
    throw friendlyRlsError(error, "You don't have permission to invite someone at that role.");
  }
  return data.token;
}

export async function revokeInvitation(invitationId: string) {
  const { error } = await supabase.from("workspace_invitations").update({ status: "revoked" }).eq("id", invitationId);
  if (error) throw friendlyRlsError(error, "You don't have permission to revoke this invitation.");
}

export async function changeMemberRole(memberRowId: string, newRole: WorkspaceRole) {
  const { error } = await supabase.from("workspace_members").update({ role: newRole }).eq("id", memberRowId);
  if (error) throw friendlyRlsError(error, "You don't have permission to change this member to that role.");
}

export async function removeMember(memberRowId: string) {
  const { error } = await supabase.from("workspace_members").delete().eq("id", memberRowId);
  if (error) throw friendlyRlsError(error, "You don't have permission to remove this member.");
}

export async function acceptWorkspaceInvitation(token: string): Promise<string> {
  const { data, error } = await supabase.rpc("accept_workspace_invitation", { p_token: token });
  if (error) throw new Error(error.message);
  return data as string;
}

// Server-side admin authorization for every admin edge function.
//
// Authenticated != admin. The caller's JWT is verified with Supabase Auth,
// then their role is read from platform_admin_roles with the service-role
// client (the table has no client policies), then the specific permission
// for the requested action is checked. Hiding a button is never the gate.
import { bearerToken, createCallerClient, createServiceClient, getCallerUserId, type AnySupabaseClient } from "../contentAuth.ts";
import { type AdminPermission, type AdminRole, can, isAdminRole } from "./permissions.ts";

export type AdminCaller = { userId: string; role: AdminRole; sb: AnySupabaseClient };

export type AdminAuthResult =
  | { ok: true; caller: AdminCaller }
  | { ok: false; status: 401 | 403; error: string };

/** Resolves the caller's admin role. Returns 401/403 without revealing why
 * beyond "Forbidden" to non-staff. */
export async function resolveAdminCaller(req: Request): Promise<AdminAuthResult> {
  const token = bearerToken(req);
  if (!token) return { ok: false, status: 401, error: "Not signed in" };
  const userId = await getCallerUserId(createCallerClient(token));
  if (!userId) return { ok: false, status: 401, error: "Not signed in" };
  const sb = createServiceClient();
  const { data, error } = await sb.from("platform_admin_roles").select("role").eq("user_id", userId).maybeSingle();
  if (error) {
    console.error("admin role lookup failed", error.message);
    return { ok: false, status: 403, error: "Forbidden" };
  }
  if (!isAdminRole(data?.role)) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true, caller: { userId, role: data.role, sb } };
}

export function permits(caller: AdminCaller, permission: AdminPermission | undefined): boolean {
  return !!permission && can(caller.role, permission);
}

export async function writeAdminAudit(sb: AnySupabaseClient, row: {
  operator: string; action: string; targetType: string; targetId?: string | null; workspaceId?: string | null; reason?: string | null; before?: unknown; after?: unknown;
}) {
  const { error } = await sb.from("platform_admin_audit").insert({
    operator_user_id: row.operator,
    action: row.action,
    target_type: row.targetType,
    target_id: row.targetId ?? null,
    workspace_id: row.workspaceId ?? null,
    reason: row.reason ?? null,
    before_state: row.before ?? null,
    after_state: row.after ?? null,
  });
  if (error) throw new Error(`audit write failed: ${error.message}`);
}

// Part 4 (launch-completion): workspace deletion.
//
// Owner-only (workspace.delete permission, mapped only to owner rank -
// see 20260915060000_workspace_deletion_export.sql). Re-verified here as
// the caller via RLS-bound has_workspace_permission, never trusted from
// the client. Requires the caller to type the workspace's own name OR
// slug as a confirmation string, checked server-side.
//
// Order of operations, each idempotent-safe so a retry after a partial
// failure never corrupts state or double-runs a side effect:
//  1. re-verify permission
//  2. verify confirmation string matches name or slug
//  3. snapshot row counts (best-effort, for the audit log only)
//  4. clear every workspace_integrations row's Vault secret
//     (clear_workspace_integration_secret is itself a no-op on a row
//     whose secret is already cleared)
//  5. purge Storage objects across all three workspace-owned buckets
//     (listing+removing an already-empty prefix is a no-op)
//  6. insert one platform_deletion_log row - the durable record that
//     survives the deletion itself (workspace_activity_log does not: it
//     cascades away with the workspace)
//  7. delete the workspaces row (cascades every other tenant-owned row)
//
// If step 4 or 5 fails, this returns an error WITHOUT reaching steps 6/7
// - nothing is left half-deleted, and the caller can safely retry.
import { bearerToken, createCallerClient, createServiceClient, getCallerUserId, hasWorkspacePermission, json } from "../_shared/contentAuth.ts";
import { purgeWorkspaceStorage } from "../_shared/workspaceLifecycle.ts";

async function countRows(sb: ReturnType<typeof createServiceClient>, table: string, workspaceId: string): Promise<number> {
  const { count } = await sb.from(table).select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
  return count ?? 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": req.headers.get("origin") || "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  }
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json(req, { error: "Forbidden" }, 403);
  const callerSb = createCallerClient(token);
  const actorId = await getCallerUserId(callerSb);
  if (!actorId) return json(req, { error: "Forbidden" }, 403);

  let body: { workspace_id?: unknown; confirm?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  const workspaceId = body.workspace_id;
  const confirm = body.confirm;
  if (typeof workspaceId !== "string" || !workspaceId) return json(req, { error: "workspace_id is required" }, 400);
  if (typeof confirm !== "string" || !confirm.trim()) return json(req, { error: "confirm is required" }, 400);

  if (!(await hasWorkspacePermission(callerSb, workspaceId, "workspace.delete"))) {
    return json(req, { error: "Forbidden" }, 403);
  }

  const sb = createServiceClient();

  const { data: workspace } = await sb.from("workspaces").select("id, name, slug").eq("id", workspaceId).maybeSingle();
  if (!workspace) return json(req, { error: "Workspace not found" }, 404);

  if (confirm.trim() !== workspace.name && confirm.trim() !== workspace.slug) {
    return json(req, { error: "confirm must exactly match the workspace's name or URL slug" }, 400);
  }

  const rowCounts: Record<string, number> = {};
  for (const table of ["leads", "opportunities", "customers", "inbox_conversations", "inbox_messages", "content_scheduled_posts", "ad_campaigns", "automations"]) {
    rowCounts[table] = await countRows(sb, table, workspaceId);
  }

  const { data: integrations } = await sb.from("workspace_integrations").select("id").eq("workspace_id", workspaceId);
  const vaultCleared: string[] = [];
  const vaultFailed: string[] = [];
  for (const integration of integrations || []) {
    const { error } = await sb.rpc("clear_workspace_integration_secret", { p_integration_id: integration.id });
    if (error) vaultFailed.push(integration.id);
    else vaultCleared.push(integration.id);
  }
  if (vaultFailed.length) {
    return json(req, { error: "Unable to clear all integration secrets - nothing was deleted. Please retry.", details: { vaultFailed } }, 500);
  }

  let storageCounts: Record<string, number>;
  try {
    storageCounts = await purgeWorkspaceStorage(sb, workspaceId);
  } catch {
    return json(req, { error: "Unable to clear all storage objects - nothing was deleted. Please retry." }, 500);
  }

  await sb.from("platform_deletion_log").insert({
    workspace_id: workspace.id,
    workspace_name: workspace.name,
    workspace_slug: workspace.slug,
    deleted_by: actorId,
    row_counts: rowCounts,
    cleanup_status: { vault_secrets_cleared: vaultCleared.length, storage_objects_removed: storageCounts, result: "ok" },
  });

  const { error: deleteError } = await sb.from("workspaces").delete().eq("id", workspaceId);
  if (deleteError) return json(req, { error: "Cleanup completed but the workspace row itself could not be deleted. Please retry or contact support." }, 500);

  return json(req, { ok: true });
});

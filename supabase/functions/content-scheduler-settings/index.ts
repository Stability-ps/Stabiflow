// Read/write for a workspace's "Automatic Publishing" database switch
// (content_scheduler_settings.auto_publish_enabled). The table has no
// insert/update/delete RLS policy for authenticated users at all (see the
// migration) - this function is the ONLY way that value can change.
//
// Adapted from Acapolite's social-scheduler-settings/index.ts: the setting
// is now per-workspace (workspace_id required in the request), and the
// authorization check is has_workspace_role(workspace_id, 'admin') via the
// caller's own session - this specific switch stays admin-gated (not
// content.publish) because it's a workspace-wide, safety-relevant toggle,
// matching how workspace_integrations (equally sensitive) is admin-gated
// elsewhere in this schema.
//
// This function only ever touches the DATABASE switch. The environment
// kill switch (CONTENT_AUTO_PUBLISH_ENABLED) is read-only here - it can
// never be changed from a workspace's UI, only reported so the dashboard
// can show whether it's currently blocking publishing.
import { decideSetAutoPublish, envKillSwitchAllowsPublishing } from "../_shared/contentSchedulerSettings.ts";
import { bearerToken, createCallerClient, createServiceClient, getCallerUserId, hasWorkspaceRole, json } from "../_shared/contentAuth.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": req.headers.get("origin") || "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json(req, { error: "Forbidden" }, 403);
  const callerSb = createCallerClient(token);
  const actorId = await getCallerUserId(callerSb);
  if (!actorId) return json(req, { error: "Forbidden" }, 403);

  let body: { action?: string; workspace_id?: string; auto_publish_enabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }

  const workspaceId = body.workspace_id;
  if (!workspaceId) return json(req, { error: "workspace_id is required" }, 400);
  if (!(await hasWorkspaceRole(callerSb, workspaceId, "admin"))) return json(req, { error: "Forbidden" }, 403);

  const envAllows = envKillSwitchAllowsPublishing();
  const serviceSb = createServiceClient();

  if (body.action === "get") {
    const { data, error } = await serviceSb.from("content_scheduler_settings").select("id, workspace_id, auto_publish_enabled, updated_by, updated_at").eq("workspace_id", workspaceId).maybeSingle();
    if (error) return json(req, { error: "Unable to load scheduler settings" }, 500);
    // A workspace created before this table existed (or, defensively, any
    // other missing-row case) reports the safe default rather than 500ing.
    if (!data) return json(req, { workspace_id: workspaceId, auto_publish_enabled: false, env_kill_switch_allows: envAllows });
    return json(req, { ...data, env_kill_switch_allows: envAllows });
  }

  if (body.action === "set") {
    if (typeof body.auto_publish_enabled !== "boolean") {
      return json(req, { error: "auto_publish_enabled (boolean) is required" }, 400);
    }
    const nextEnabled = body.auto_publish_enabled;

    const { data: current, error: currentError } = await serviceSb.from("content_scheduler_settings").select("id, auto_publish_enabled").eq("workspace_id", workspaceId).maybeSingle();
    if (currentError) return json(req, { error: "Unable to load scheduler settings" }, 500);
    if (!current) return json(req, { error: "Scheduler settings row not found for this workspace" }, 404);

    // actor is always a workspace admin here (already gated above);
    // isWorkspaceAdmin: true reflects that boundary while keeping the
    // actual enable/no-op decision in a directly testable pure function.
    const decision = decideSetAutoPublish({ isWorkspaceAdmin: true, currentEnabled: current.auto_publish_enabled, requestedEnabled: nextEnabled });

    if (decision.action === "no_change") {
      return json(req, { ok: true, auto_publish_enabled: decision.enabled, env_kill_switch_allows: envAllows, changed: false });
    }
    if (decision.action === "forbidden") return json(req, { error: "Forbidden" }, 403); // unreachable: the workspace-admin check above already gated this

    const nowIso = new Date().toISOString();
    const { error: updateError } = await serviceSb
      .from("content_scheduler_settings")
      .update({ auto_publish_enabled: decision.enabled, updated_by: actorId, updated_at: nowIso })
      .eq("id", current.id);
    if (updateError) return json(req, { error: "Unable to update scheduler settings" }, 500);

    await serviceSb.from("workspace_activity_log").insert({
      workspace_id: workspaceId,
      actor_user_id: actorId,
      action: decision.enabled ? "content_auto_publish_enabled" : "content_auto_publish_disabled",
      target_type: "content_scheduler_settings",
      target_id: current.id,
      metadata: { previous_value: current.auto_publish_enabled, new_value: decision.enabled, env_kill_switch_allows: envAllows },
    });

    return json(req, { ok: true, auto_publish_enabled: decision.enabled, env_kill_switch_allows: envAllows, changed: true });
  }

  return json(req, { error: "action must be 'get' or 'set'" }, 400);
});

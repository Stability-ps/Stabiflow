// Launch-completion. Internal platform-operator surface - a StabiFlow
// employee/support capability, completely separate from workspace roles.
//
// Authorization model, deliberately different from every other edge
// function in this codebase: there is NO has_workspace_permission check
// here at all, because operator actions are not scoped to a workspace the
// caller is a member of - they target ANY workspace on the platform. The
// only gate is profiles.is_platform_operator, checked server-side via the
// SERVICE-ROLE client (never the caller's own client, since RLS has no
// operator-bypass policy by design - see the migration's comment). There
// is no client-reachable way to set this flag on your own profile.
//
// One action dispatcher (same "one endpoint, one action field, real audit
// trail" shape as inbox-actions/leads-actions), not a REST-per-verb
// surface, matching this codebase's established convention.
import { bearerToken, createCallerClient, createServiceClient, getCallerUserId, json } from "../_shared/contentAuth.ts";

const VALID_ACTIONS = new Set(["search_workspaces", "get_workspace", "suspend_workspace", "unsuspend_workspace"]);

async function requireOperator(serviceSb: ReturnType<typeof createServiceClient>, userId: string): Promise<boolean> {
  const { data } = await serviceSb.from("profiles").select("is_platform_operator").eq("id", userId).maybeSingle();
  return data?.is_platform_operator === true;
}

async function logOperatorAction(serviceSb: ReturnType<typeof createServiceClient>, operatorUserId: string, workspaceId: string, action: string, reason: string) {
  await serviceSb.from("platform_operator_actions").insert({ operator_user_id: operatorUserId, workspace_id: workspaceId, action, reason });
}

Deno.serve(async (req: Request) => {
  const cors = { "Access-Control-Allow-Origin": req.headers.get("origin") || "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json(req, { error: "Forbidden" }, 403);
  const callerSb = createCallerClient(token);
  const actorId = await getCallerUserId(callerSb);
  if (!actorId) return json(req, { error: "Forbidden" }, 403);

  const serviceSb = createServiceClient();
  if (!(await requireOperator(serviceSb, actorId))) {
    return json(req, { error: "Forbidden" }, 403);
  }

  let body: { action?: unknown; query?: unknown; workspace_id?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }

  const action = body.action;
  if (typeof action !== "string" || !VALID_ACTIONS.has(action)) return json(req, { error: "Unknown action" }, 400);

  if (action === "search_workspaces") {
    const query = typeof body.query === "string" ? body.query.trim() : "";
    let q = serviceSb.from("workspaces").select("id, name, slug, created_at").order("created_at", { ascending: false }).limit(25);
    if (query) q = q.or(`name.ilike.%${query}%,slug.ilike.%${query}%`);
    const { data, error } = await q;
    if (error) return json(req, { error: "Search failed" }, 500);
    return json(req, { ok: true, workspaces: data });
  }

  const workspaceId = body.workspace_id;
  if (typeof workspaceId !== "string" || !workspaceId) return json(req, { error: "workspace_id is required" }, 400);

  if (action === "get_workspace") {
    const [{ data: workspace }, { data: billing }, { data: members }, { data: integrations }, { data: aiUsage }, { data: failedRuns }] = await Promise.all([
      serviceSb.from("workspaces").select("id, name, slug, created_at").eq("id", workspaceId).maybeSingle(),
      serviceSb.from("workspace_billing").select("plan, status, trial_ends_at, limits").eq("workspace_id", workspaceId).maybeSingle(),
      serviceSb.from("workspace_members").select("user_id, role, joined_at, profiles(full_name)").eq("workspace_id", workspaceId),
      serviceSb.from("workspace_integrations").select("provider, status, last_health_check_status, last_health_check_at").eq("workspace_id", workspaceId),
      serviceSb.from("ai_usage_events").select("total_tokens, estimated_cost, status, created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100),
      serviceSb.from("automation_runs").select("id, automation_id, status, error, created_at").eq("workspace_id", workspaceId).in("status", ["failed", "blocked_permission"]).order("created_at", { ascending: false }).limit(20),
    ]);
    if (!workspace) return json(req, { error: "Workspace not found" }, 404);

    type AiUsageRow = { total_tokens: number | null; estimated_cost: number | null; status: string };
    const aiUsageSummary = ((aiUsage || []) as AiUsageRow[]).reduce(
      (acc, row) => {
        acc.totalTokens += row.total_tokens || 0;
        acc.totalCost += Number(row.estimated_cost) || 0;
        if (row.status === "blocked_quota") acc.blockedQuotaCount += 1;
        return acc;
      },
      { totalTokens: 0, totalCost: 0, blockedQuotaCount: 0, sampleSize: (aiUsage || []).length },
    );

    return json(req, { ok: true, workspace, billing, members, integrations, aiUsageSummary, recentFailedAutomationRuns: failedRuns });
  }

  if (action === "suspend_workspace" || action === "unsuspend_workspace") {
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) return json(req, { error: "A reason is required for this action" }, 400);

    const { data: billing } = await serviceSb.from("workspace_billing").select("workspace_id").eq("workspace_id", workspaceId).maybeSingle();
    if (!billing) return json(req, { error: "Workspace not found" }, 404);

    // Unsuspend always restores to 'active', not whatever the workspace's
    // pre-suspension status was (trial vs active isn't tracked separately
    // today) - acceptable for V1 since status changes are operator-only;
    // an operator who needs to put a workspace back on 'trial' specifically
    // can do so via a follow-up direct update. Revisit if that distinction
    // matters once trials are more than a default.
    const newStatus = action === "suspend_workspace" ? "suspended" : "active";
    const { error } = await serviceSb.from("workspace_billing").update({ status: newStatus }).eq("workspace_id", workspaceId);
    if (error) return json(req, { error: "Failed to update workspace status" }, 500);

    await logOperatorAction(serviceSb, actorId, workspaceId, action, reason);
    return json(req, { ok: true, status: newStatus });
  }

  return json(req, { error: "Unknown action" }, 400);
});

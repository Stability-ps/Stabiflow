// Pipeline/stage configuration actions (Phase E). Same dispatcher shape as
// leads-actions/inbox-actions. Every workspace configures its own
// sales/service process (durable rule #8/#10) - nothing here is a
// universal StabiFlow pipeline; ensure_default_pipeline only ever creates
// a safe, generic New -> Qualified -> Proposal -> Won starting point, and
// is idempotent (races into the unique partial index on pipelines.is_default,
// not a second default).
import { bearerToken, createCallerClient, createServiceClient, getCallerUserId, hasWorkspacePermission, json, type AnySupabaseClient } from "../_shared/contentAuth.ts";

const VALID_ACTIONS = new Set([
  "ensure_default_pipeline",
  "create_pipeline",
  "rename_pipeline",
  "set_default_pipeline",
  "add_stage",
  "rename_stage",
  "reorder_stages",
  "set_stage_active",
  "set_stage_flags",
]);

const DEFAULT_STAGE_NAMES = ["New", "Qualified", "Proposal", "Won"];

async function logActivity(sb: AnySupabaseClient, workspaceId: string, actorId: string, action: string, targetId: string | null, metadata: Record<string, unknown> = {}) {
  await sb.from("workspace_activity_log").insert({ workspace_id: workspaceId, actor_user_id: actorId, action, target_type: "pipeline", target_id: targetId, metadata });
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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }

  const workspaceId = body.workspace_id;
  const action = body.action;
  if (typeof workspaceId !== "string" || !workspaceId) return json(req, { error: "workspace_id is required" }, 400);
  if (typeof action !== "string" || !VALID_ACTIONS.has(action)) return json(req, { error: "Unknown action" }, 400);

  const serviceSb = createServiceClient();

  if (action === "ensure_default_pipeline") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "pipeline.view"))) return json(req, { error: "Forbidden" }, 403);

    const { data: existingDefault } = await serviceSb.from("pipelines").select("id").eq("workspace_id", workspaceId).eq("is_default", true).maybeSingle();
    if (existingDefault) return json(req, { pipeline_id: existingDefault.id, created: false });

    const { data: pipeline, error: pipelineError } = await serviceSb
      .from("pipelines")
      .insert({ workspace_id: workspaceId, name: "Default pipeline", is_default: true, created_by: actorId })
      .select("id")
      .single();

    if (pipelineError) {
      // Idempotent race guard: another request already created the default
      // between our check and our insert - the unique partial index
      // rejected ours, so treat that as success and return theirs.
      if (pipelineError.code === "23505") {
        const { data: raceWinner } = await serviceSb.from("pipelines").select("id").eq("workspace_id", workspaceId).eq("is_default", true).maybeSingle();
        if (raceWinner) return json(req, { pipeline_id: raceWinner.id, created: false });
      }
      return json(req, { error: "Unable to create the default pipeline" }, 500);
    }

    const { error: stagesError } = await serviceSb.from("pipeline_stages").insert(
      DEFAULT_STAGE_NAMES.map((name, index) => ({
        workspace_id: workspaceId,
        pipeline_id: pipeline.id,
        name,
        sort_order: index,
        is_won_stage: name === "Won",
      })),
    );
    if (stagesError) return json(req, { error: "Unable to create the default pipeline's stages" }, 500);

    await logActivity(serviceSb, workspaceId, actorId, "pipeline_created", pipeline.id, { name: "Default pipeline", default: true });
    return json(req, { pipeline_id: pipeline.id, created: true });
  }

  if (action === "create_pipeline") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "pipeline.manage"))) return json(req, { error: "Forbidden" }, 403);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return json(req, { error: "name is required" }, 400);

    const { data: pipeline, error } = await serviceSb.from("pipelines").insert({ workspace_id: workspaceId, name, created_by: actorId }).select("*").single();
    if (error || !pipeline) return json(req, { error: "Unable to create this pipeline" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, "pipeline_created", pipeline.id, { name });
    return json(req, { pipeline });
  }

  if (action === "rename_pipeline") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "pipeline.manage"))) return json(req, { error: "Forbidden" }, 403);
    const pipelineId = body.pipeline_id;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (typeof pipelineId !== "string" || !pipelineId) return json(req, { error: "pipeline_id is required" }, 400);
    if (!name) return json(req, { error: "name is required" }, 400);

    const { data: pipeline } = await serviceSb.from("pipelines").select("id").eq("id", pipelineId).eq("workspace_id", workspaceId).maybeSingle();
    if (!pipeline) return json(req, { error: "Pipeline not found" }, 404);

    const { error } = await serviceSb.from("pipelines").update({ name }).eq("id", pipelineId);
    if (error) return json(req, { error: "Unable to rename this pipeline" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, "pipeline_renamed", pipelineId, { name });
    return json(req, { ok: true });
  }

  if (action === "set_default_pipeline") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "pipeline.manage"))) return json(req, { error: "Forbidden" }, 403);
    const pipelineId = body.pipeline_id;
    if (typeof pipelineId !== "string" || !pipelineId) return json(req, { error: "pipeline_id is required" }, 400);

    const { data: pipeline } = await serviceSb.from("pipelines").select("id").eq("id", pipelineId).eq("workspace_id", workspaceId).maybeSingle();
    if (!pipeline) return json(req, { error: "Pipeline not found" }, 404);

    // Unset THEN set, so the unique partial index (workspace_id) where
    // is_default never sees two true rows at once, even momentarily.
    const { error: unsetError } = await serviceSb.from("pipelines").update({ is_default: false }).eq("workspace_id", workspaceId).eq("is_default", true).neq("id", pipelineId);
    if (unsetError) return json(req, { error: "Unable to change the default pipeline" }, 500);
    const { error: setError } = await serviceSb.from("pipelines").update({ is_default: true }).eq("id", pipelineId);
    if (setError) return json(req, { error: "Unable to change the default pipeline" }, 500);

    await logActivity(serviceSb, workspaceId, actorId, "pipeline_default_changed", pipelineId, {});
    return json(req, { ok: true });
  }

  if (action === "add_stage") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "pipeline.manage"))) return json(req, { error: "Forbidden" }, 403);
    const pipelineId = body.pipeline_id;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (typeof pipelineId !== "string" || !pipelineId) return json(req, { error: "pipeline_id is required" }, 400);
    if (!name) return json(req, { error: "name is required" }, 400);

    const { data: pipeline } = await serviceSb.from("pipelines").select("id").eq("id", pipelineId).eq("workspace_id", workspaceId).maybeSingle();
    if (!pipeline) return json(req, { error: "Pipeline not found" }, 404);

    const { data: stages } = await serviceSb.from("pipeline_stages").select("sort_order").eq("pipeline_id", pipelineId).order("sort_order", { ascending: false }).limit(1);
    const nextSortOrder = (stages?.[0]?.sort_order ?? -1) + 1;

    const { data: stage, error } = await serviceSb.from("pipeline_stages").insert({ workspace_id: workspaceId, pipeline_id: pipelineId, name, sort_order: nextSortOrder }).select("*").single();
    if (error || !stage) return json(req, { error: "Unable to add this stage" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, "pipeline_stage_added", pipelineId, { stage_id: stage.id, name });
    return json(req, { stage });
  }

  if (action === "rename_stage") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "pipeline.manage"))) return json(req, { error: "Forbidden" }, 403);
    const stageId = body.stage_id;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (typeof stageId !== "string" || !stageId) return json(req, { error: "stage_id is required" }, 400);
    if (!name) return json(req, { error: "name is required" }, 400);

    const { data: stage } = await serviceSb.from("pipeline_stages").select("id, pipeline_id").eq("id", stageId).eq("workspace_id", workspaceId).maybeSingle();
    if (!stage) return json(req, { error: "Stage not found" }, 404);

    const { error } = await serviceSb.from("pipeline_stages").update({ name }).eq("id", stageId);
    if (error) return json(req, { error: "Unable to rename this stage" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, "pipeline_stage_renamed", stage.pipeline_id, { stage_id: stageId, name });
    return json(req, { ok: true });
  }

  if (action === "reorder_stages") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "pipeline.manage"))) return json(req, { error: "Forbidden" }, 403);
    const pipelineId = body.pipeline_id;
    const stageIds = body.stage_ids;
    if (typeof pipelineId !== "string" || !pipelineId) return json(req, { error: "pipeline_id is required" }, 400);
    if (!Array.isArray(stageIds) || stageIds.some((id) => typeof id !== "string")) return json(req, { error: "stage_ids must be an array of ids" }, 400);

    const { data: existingStages } = await serviceSb.from("pipeline_stages").select("id").eq("pipeline_id", pipelineId).eq("workspace_id", workspaceId);
    const existingIds = new Set((existingStages || []).map((s: { id: string }) => s.id));
    if (existingIds.size !== stageIds.length || !stageIds.every((id) => existingIds.has(id))) {
      return json(req, { error: "stage_ids must contain exactly this pipeline's existing stages, each exactly once" }, 400);
    }

    for (let index = 0; index < stageIds.length; index++) {
      const { error } = await serviceSb.from("pipeline_stages").update({ sort_order: index }).eq("id", stageIds[index]);
      if (error) return json(req, { error: "Unable to reorder stages" }, 500);
    }
    await logActivity(serviceSb, workspaceId, actorId, "pipeline_stages_reordered", pipelineId, { stage_ids: stageIds });
    return json(req, { ok: true });
  }

  if (action === "set_stage_active") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "pipeline.manage"))) return json(req, { error: "Forbidden" }, 403);
    const stageId = body.stage_id;
    const isActive = body.is_active;
    if (typeof stageId !== "string" || !stageId) return json(req, { error: "stage_id is required" }, 400);
    if (typeof isActive !== "boolean") return json(req, { error: "is_active must be a boolean" }, 400);

    const { data: stage } = await serviceSb.from("pipeline_stages").select("id, pipeline_id").eq("id", stageId).eq("workspace_id", workspaceId).maybeSingle();
    if (!stage) return json(req, { error: "Stage not found" }, 404);

    const { error } = await serviceSb.from("pipeline_stages").update({ is_active: isActive }).eq("id", stageId);
    if (error) return json(req, { error: "Unable to update this stage" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, isActive ? "pipeline_stage_activated" : "pipeline_stage_deactivated", stage.pipeline_id, { stage_id: stageId });
    return json(req, { ok: true });
  }

  // action === "set_stage_flags"
  if (!(await hasWorkspacePermission(callerSb, workspaceId, "pipeline.manage"))) return json(req, { error: "Forbidden" }, 403);
  const stageId = body.stage_id;
  if (typeof stageId !== "string" || !stageId) return json(req, { error: "stage_id is required" }, 400);

  const { data: stage } = await serviceSb.from("pipeline_stages").select("id, pipeline_id").eq("id", stageId).eq("workspace_id", workspaceId).maybeSingle();
  if (!stage) return json(req, { error: "Stage not found" }, 404);

  const update: Record<string, boolean> = {};
  if (typeof body.is_won_stage === "boolean") update.is_won_stage = body.is_won_stage;
  if (typeof body.is_lost_stage === "boolean") update.is_lost_stage = body.is_lost_stage;
  if (Object.keys(update).length === 0) return json(req, { error: "is_won_stage or is_lost_stage is required" }, 400);

  // Clear any other stage in this pipeline currently holding the flag
  // being set to true, so the unique partial index never rejects this as
  // a second won/lost stage - "moving" the flag, not just claiming it.
  if (update.is_won_stage === true) await serviceSb.from("pipeline_stages").update({ is_won_stage: false }).eq("pipeline_id", stage.pipeline_id).eq("is_won_stage", true);
  if (update.is_lost_stage === true) await serviceSb.from("pipeline_stages").update({ is_lost_stage: false }).eq("pipeline_id", stage.pipeline_id).eq("is_lost_stage", true);

  const { error } = await serviceSb.from("pipeline_stages").update(update).eq("id", stageId);
  if (error) return json(req, { error: "Unable to update this stage's flags" }, 500);
  await logActivity(serviceSb, workspaceId, actorId, "pipeline_stage_flag_changed", stage.pipeline_id, { stage_id: stageId, ...update });
  return json(req, { ok: true });
});

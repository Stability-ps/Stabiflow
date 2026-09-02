// Automation configuration actions (Phase J). Same dispatcher shape as
// leads-actions/pipelines-actions - one endpoint, one `action` field,
// every write server-side. Reads (listing automations/conditions/actions/
// runs) go directly through supabase-js against the RLS-protected tables,
// same as ai_conversations/ai_messages in Phase I - only writes need a
// dispatcher.
import {
  bearerToken, corsHeaders, createCallerClient, createServiceClient, getCallerUserId, hasWorkspacePermission, json, type AnySupabaseClient,
} from "../_shared/contentAuth.ts";
import { isActionType, isConditionOperator, isEventType } from "../_shared/automations/taxonomy.ts";

const VALID_ACTIONS = new Set(["create", "update", "set_status", "delete"]);

// Which permission the automation's creator must CURRENTLY hold for each
// action_type - checked at enable time (readiness) and re-checked at
// execution time by automations-tick via has_workspace_permission_for().
const ACTION_REQUIRED_PERMISSION: Record<string, string> = {
  create_lead: "lead.create",
  assign_lead: "lead.assign",
  update_lead_stage: "lead.edit",
  create_opportunity: "opportunity.create",
  assign_opportunity: "opportunity.edit",
  create_internal_note: "lead.edit",
  create_notification: "automation.enable",
  request_flow_ai_analysis: "flow_ai.use",
  set_conversation_priority: "inbox.manage",
  set_conversation_handoff: "inbox.manage",
  send_whatsapp_template: "inbox.manage",
  request_document: "inbox.manage",
  add_tag: "inbox.manage",
};

const IDLE_TRIGGERS = new Set(["lead.idle_timeout", "conversation.idle_timeout"]);

type ConditionInput = { field: string; operator: string; value: unknown };
type ActionInput = { action_type: string; action_config: Record<string, unknown> };

function validateConditions(conditions: unknown): conditions is ConditionInput[] {
  if (!Array.isArray(conditions)) return false;
  return conditions.every((c) => c && typeof c.field === "string" && c.field.length > 0 && c.field.length <= 100 && typeof c.operator === "string" && isConditionOperator(c.operator));
}

function validateActions(actions: unknown): actions is ActionInput[] {
  if (!Array.isArray(actions) || actions.length === 0) return false;
  return actions.every((a) => a && typeof a.action_type === "string" && isActionType(a.action_type) && (a.action_config === undefined || typeof a.action_config === "object"));
}

async function replaceConditionsAndActions(sb: AnySupabaseClient, workspaceId: string, automationId: string, conditions: ConditionInput[] | undefined, actions: ActionInput[] | undefined) {
  if (conditions) {
    await sb.from("automation_conditions").delete().eq("automation_id", automationId);
    if (conditions.length > 0) {
      await sb.from("automation_conditions").insert(conditions.map((c, i) => ({ automation_id: automationId, workspace_id: workspaceId, field: c.field, operator: c.operator, value: c.value ?? null, sort_order: i })));
    }
  }
  if (actions) {
    await sb.from("automation_actions").delete().eq("automation_id", automationId);
    await sb.from("automation_actions").insert(actions.map((a, i) => ({ automation_id: automationId, workspace_id: workspaceId, sort_order: i, action_type: a.action_type, action_config: a.action_config ?? {} })));
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json(req, { error: "Forbidden" }, 403);
  const callerSb = createCallerClient(token);
  const serviceSb = createServiceClient();
  const actorId = await getCallerUserId(callerSb);
  if (!actorId) return json(req, { error: "Forbidden" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }

  const action = body.action;
  if (typeof action !== "string" || !VALID_ACTIONS.has(action)) return json(req, { error: "Invalid action" }, 400);
  const workspaceId = body.workspace_id;
  if (typeof workspaceId !== "string" || !workspaceId) return json(req, { error: "workspace_id is required" }, 400);

  if (action === "create") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "automation.create"))) return json(req, { error: "Forbidden" }, 403);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const triggerEventType = body.trigger_event_type;
    if (!name) return json(req, { error: "name is required" }, 400);
    if (typeof triggerEventType !== "string" || !isEventType(triggerEventType)) return json(req, { error: "A valid trigger_event_type is required" }, 400);
    const idleTimeoutMinutes = IDLE_TRIGGERS.has(triggerEventType) ? Number(body.idle_timeout_minutes) : null;
    if (IDLE_TRIGGERS.has(triggerEventType) && (!idleTimeoutMinutes || idleTimeoutMinutes <= 0)) {
      return json(req, { error: `idle_timeout_minutes is required and must be positive for a ${triggerEventType} trigger` }, 400);
    }
    if (body.conditions !== undefined && !validateConditions(body.conditions)) return json(req, { error: "Invalid conditions" }, 400);
    if (body.actions !== undefined && !validateActions(body.actions)) return json(req, { error: "At least one valid action is required" }, 400);

    const { data: automation, error } = await serviceSb
      .from("automations")
      .insert({ workspace_id: workspaceId, name, trigger_event_type: triggerEventType, idle_timeout_minutes: idleTimeoutMinutes, created_by: actorId, status: "draft" })
      .select("*")
      .single();
    if (error || !automation) return json(req, { error: "Unable to create this automation" }, 500);

    await replaceConditionsAndActions(serviceSb, workspaceId, automation.id, (body.conditions as ConditionInput[]) ?? [], (body.actions as ActionInput[]) ?? undefined);
    await serviceSb.from("workspace_activity_log").insert({ workspace_id: workspaceId, actor_user_id: actorId, action: "automation_created", target_type: "automation", target_id: automation.id, metadata: { trigger_event_type: triggerEventType } });
    return json(req, { automation, created: true });
  }

  if (action === "update") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "automation.edit"))) return json(req, { error: "Forbidden" }, 403);
    const automationId = body.automation_id;
    if (typeof automationId !== "string" || !automationId) return json(req, { error: "automation_id is required" }, 400);
    const { data: existing } = await serviceSb.from("automations").select("id").eq("id", automationId).eq("workspace_id", workspaceId).maybeSingle();
    if (!existing) return json(req, { error: "Automation not found" }, 404);

    if (body.conditions !== undefined && !validateConditions(body.conditions)) return json(req, { error: "Invalid conditions" }, 400);
    if (body.actions !== undefined && !validateActions(body.actions)) return json(req, { error: "At least one valid action is required" }, 400);

    const updates: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
    if (typeof body.trigger_event_type === "string" && isEventType(body.trigger_event_type)) updates.trigger_event_type = body.trigger_event_type;
    if (body.idle_timeout_minutes !== undefined) updates.idle_timeout_minutes = Number(body.idle_timeout_minutes) || null;
    if (Object.keys(updates).length > 0) {
      const { error } = await serviceSb.from("automations").update(updates).eq("id", automationId);
      if (error) return json(req, { error: "Unable to update this automation" }, 500);
    }
    await replaceConditionsAndActions(serviceSb, workspaceId, automationId, body.conditions as ConditionInput[] | undefined, body.actions as ActionInput[] | undefined);
    await serviceSb.from("workspace_activity_log").insert({ workspace_id: workspaceId, actor_user_id: actorId, action: "automation_updated", target_type: "automation", target_id: automationId, metadata: {} });
    return json(req, { ok: true });
  }

  if (action === "set_status") {
    const automationId = body.automation_id;
    const status = body.status;
    if (typeof automationId !== "string" || !automationId) return json(req, { error: "automation_id is required" }, 400);
    if (status !== "enabled" && status !== "disabled") return json(req, { error: "status must be 'enabled' or 'disabled'" }, 400);
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "automation.enable"))) return json(req, { error: "Forbidden" }, 403);

    const { data: automation } = await serviceSb.from("automations").select("id, created_by").eq("id", automationId).eq("workspace_id", workspaceId).maybeSingle();
    if (!automation) return json(req, { error: "Automation not found" }, 404);

    if (status === "enabled") {
      const { data: actions } = await serviceSb.from("automation_actions").select("action_type").eq("automation_id", automationId);
      if (!actions || actions.length === 0) return json(req, { error: "This automation has no actions - add at least one before enabling" }, 400);
      for (const a of actions as { action_type: string }[]) {
        const requiredPermission = ACTION_REQUIRED_PERMISSION[a.action_type];
        if (requiredPermission) {
          const { data: hasPermission } = await serviceSb.rpc("has_workspace_permission_for", { p_workspace_id: workspaceId, p_permission: requiredPermission, p_user_id: automation.created_by });
          if (!hasPermission) return json(req, { error: `This automation's creator no longer has the "${requiredPermission}" permission required by its "${a.action_type}" action - it cannot be enabled until that's resolved.` }, 400);
        }
      }
    }

    const { error } = await serviceSb.from("automations").update({ status }).eq("id", automationId);
    if (error) return json(req, { error: "Unable to update this automation's status" }, 500);
    await serviceSb.from("workspace_activity_log").insert({ workspace_id: workspaceId, actor_user_id: actorId, action: `automation_${status}`, target_type: "automation", target_id: automationId, metadata: {} });
    return json(req, { ok: true });
  }

  if (action === "delete") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "automation.delete"))) return json(req, { error: "Forbidden" }, 403);
    const automationId = body.automation_id;
    if (typeof automationId !== "string" || !automationId) return json(req, { error: "automation_id is required" }, 400);
    const { error } = await serviceSb.from("automations").delete().eq("id", automationId).eq("workspace_id", workspaceId);
    if (error) return json(req, { error: "Unable to delete this automation" }, 500);
    await serviceSb.from("workspace_activity_log").insert({ workspace_id: workspaceId, actor_user_id: actorId, action: "automation_deleted", target_type: "automation", target_id: automationId, metadata: {} });
    return json(req, { ok: true });
  }

  return json(req, { error: "Unhandled action" }, 400);
});

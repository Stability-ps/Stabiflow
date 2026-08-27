// Maps a controlled action_type to the SAME dispatcher edge functions the
// UI already calls (leads-actions) - via the impersonated access token
// from actAsUser.ts - or, for the two action types with no existing
// dispatcher (create_notification, request_flow_ai_analysis), a thin,
// narrowly-scoped operation of its own. No action type here can reach an
// arbitrary table, arbitrary SQL, an arbitrary URL, WhatsApp sending, or
// any Meta campaign mutation - the registry in taxonomy.ts is exhaustive.
import { envVar, type AnySupabaseClient } from "../contentAuth.ts";
import type { ActionType } from "./taxonomy.ts";

export type ActionResult = { status: "succeeded" | "failed"; result?: unknown; error?: string };

// Resolves "$event.<dot.path>" string leaves in an action_config object
// against the triggering domain event's payload - e.g. {"lead_id":
// "$event.entity_id"}. Never a general template engine (no arithmetic, no
// loops) - just a single substitution point per leaf value, which is all
// V1's action configs need.
function resolveTemplate(value: unknown, event: { entityId: string | null; payload: Record<string, unknown> }): unknown {
  if (typeof value !== "string" || !value.startsWith("$event.")) return value;
  const path = value.slice("$event.".length);
  if (path === "entity_id") return event.entityId;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, event.payload);
}

function resolveConfig(config: Record<string, unknown>, event: { entityId: string | null; payload: Record<string, unknown> }): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) resolved[key] = resolveTemplate(value, event);
  return resolved;
}

async function callDispatcher(functionName: string, accessToken: string, body: Record<string, unknown>, automationContext?: AutomationContext): Promise<ActionResult> {
  const res = await fetch(`${envVar("SUPABASE_URL")}/functions/v1/${functionName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(automationContext ? { ...body, _automation_context: automationContext } : body),
  });
  const responseBody = await res.json().catch(() => ({}));
  if (!res.ok) return { status: "failed", error: typeof responseBody.error === "string" ? responseBody.error : `${functionName} returned ${res.status}` };
  return { status: "succeeded", result: responseBody };
}

// Reads flow-ai-chat's SSE stream to completion and returns the final
// assistant text - the automation worker isn't a browser and doesn't need
// progressive rendering, just the finished analysis.
async function callFlowAiAnalysis(accessToken: string, workspaceId: string, prompt: string): Promise<ActionResult> {
  const res = await fetch(`${envVar("SUPABASE_URL")}/functions/v1/flow-ai-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ workspaceId, message: prompt }),
  });
  if (!res.ok || !res.body) return { status: "failed", error: `flow-ai-chat returned ${res.status}` };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let conversationId: string | null = null;
  let errorMessage: string | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
      if (dataLine) {
        try {
          const event = JSON.parse(dataLine.slice(5).trim());
          if (event.type === "text_delta") text += event.text;
          else if (event.type === "conversation_id") conversationId = event.id;
          else if (event.type === "error") errorMessage = event.message;
        } catch {
          // ignore a malformed frame - the stream continues
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
  if (errorMessage) return { status: "failed", error: errorMessage };
  return { status: "succeeded", result: { conversationId, analysis: text } };
}

export type AutomationContext = { runId: string; automationId: string; correlationId: string; depth: number };

export async function dispatchAction(opts: {
  actionType: ActionType;
  actionConfig: Record<string, unknown>;
  event: { entityType: string; entityId: string | null; payload: Record<string, unknown> };
  workspaceId: string;
  accessToken: string;
  serviceClient: AnySupabaseClient;
  actorUserId: string;
  automationContext?: AutomationContext;
}): Promise<ActionResult> {
  const config = resolveConfig(opts.actionConfig, { entityId: opts.event.entityId, payload: opts.event.payload });

  switch (opts.actionType) {
    case "create_lead":
      return callDispatcher("leads-actions", opts.accessToken, { workspace_id: opts.workspaceId, action: "create_manual", ...config }, opts.automationContext);

    case "assign_lead":
      return callDispatcher("leads-actions", opts.accessToken, { workspace_id: opts.workspaceId, action: "assign", target_type: "lead", target_id: config.lead_id ?? opts.event.entityId, staff_id: config.staff_id }, opts.automationContext);

    case "assign_opportunity":
      return callDispatcher("leads-actions", opts.accessToken, { workspace_id: opts.workspaceId, action: "assign", target_type: "opportunity", target_id: config.opportunity_id ?? opts.event.entityId, staff_id: config.staff_id }, opts.automationContext);

    case "update_lead_stage":
      return callDispatcher("leads-actions", opts.accessToken, { workspace_id: opts.workspaceId, action: "move_stage", lead_id: config.lead_id ?? opts.event.entityId, pipeline_id: config.pipeline_id, pipeline_stage_id: config.pipeline_stage_id }, opts.automationContext);

    case "create_opportunity":
      return callDispatcher("leads-actions", opts.accessToken, { workspace_id: opts.workspaceId, action: "create_opportunity", lead_id: config.lead_id ?? opts.event.entityId, title: config.title, pipeline_id: config.pipeline_id, pipeline_stage_id: config.pipeline_stage_id }, opts.automationContext);

    case "create_internal_note": {
      const targetType = config.target_type === "opportunity" ? "opportunity" : "lead";
      return callDispatcher("leads-actions", opts.accessToken, { workspace_id: opts.workspaceId, action: "add_note", target_type: targetType, target_id: config.target_id ?? opts.event.entityId, note: config.note }, opts.automationContext);
    }

    case "create_notification": {
      // No existing dispatcher and no bespoke permission model -
      // notifications are workspace-internal, low-risk records with no
      // cross-cutting business rule beyond "the recipient is a member of
      // this workspace" (checked via the FK + RLS on read, not here).
      const userId = typeof config.user_id === "string" ? config.user_id : opts.actorUserId;
      const { error } = await opts.serviceClient.from("notifications").insert({
        workspace_id: opts.workspaceId,
        user_id: userId,
        type: "automation",
        title: typeof config.title === "string" ? config.title : "Automation notification",
        body: typeof config.body === "string" ? config.body : null,
        related_entity_type: opts.event.entityType,
        related_entity_id: opts.event.entityId,
      });
      if (error) return { status: "failed", error: error.message };
      return { status: "succeeded" };
    }

    case "request_flow_ai_analysis": {
      const prompt = typeof config.prompt === "string" && config.prompt.length > 0
        ? config.prompt
        : `An automation was triggered by a ${opts.event.entityType} event. Please analyze the relevant recent performance and summarize anything notable.`;
      return callFlowAiAnalysis(opts.accessToken, opts.workspaceId, prompt);
    }

    default:
      return { status: "failed", error: `Unknown action_type: ${opts.actionType}` };
  }
}

// Flow AI's curated tool registry (Phase I, V1 = READ + RECOMMEND only).
//
// Every tool here is a thin wrapper around an existing or new read-only
// RPC, called with the CALLER's own JWT (never service role) so RLS is
// the actual isolation boundary - identical to how every edge function in
// this codebase already resolves authorization (see
// supabase/functions/_shared/contentAuth.ts's createCallerClient). Each
// RPC additionally self-gates on the SAME permission the source module
// already requires (view_analytics, revenue.view, campaign.view,
// lead.view, opportunity.view, integration.view, content.view) - Flow AI
// never introduces a parallel authorization path.
//
// Deliberately absent from every tool's JSON-schema `parameters`: a
// workspace_id field. The model has no slot to put one in even if
// prompted to - workspace_id always comes from the server-resolved
// conversation (see flow-ai-chat/index.ts), never from model output.
import type { AnySupabaseClient } from "../contentAuth.ts";

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  // The permission this tool's own RPC already re-checks server-side -
  // recorded here only for documentation/tests, NOT relied on as the
  // actual authorization (the RPC's own `has_workspace_permission` call
  // inside the database is the real boundary).
  requiresPermission: string;
};

const DATE_RANGE_PARAMS = {
  date_from: { type: "string", description: "ISO 8601 timestamp, inclusive start of the range." },
  date_to: { type: "string", description: "ISO 8601 timestamp, exclusive end of the range." },
};

export const FLOW_AI_TOOLS: ToolDefinition[] = [
  {
    name: "get_analytics_kpis",
    description: "Workspace-wide KPI totals (spend, conversations, leads, qualified leads, opportunities, customers, revenue) for a date range.",
    requiresPermission: "view_analytics",
    parameters: { type: "object", additionalProperties: false, required: ["date_from", "date_to"], properties: { ...DATE_RANGE_PARAMS } },
  },
  {
    name: "get_campaign_performance",
    description: "Per-campaign performance (spend, impressions, clicks, conversions, revenue, ROAS) for a date range under a given attribution model.",
    requiresPermission: "view_analytics",
    parameters: {
      type: "object", additionalProperties: false, required: ["date_from", "date_to"],
      properties: {
        ...DATE_RANGE_PARAMS,
        attribution_model: { type: "string", enum: ["first_touch", "last_touch", "first_paid_touch", "last_paid_touch"], description: "Defaults to last_touch if omitted." },
      },
    },
  },
  {
    name: "get_creative_performance",
    description: "Per-creative conversion counts and attributable revenue for a date range. No spend/impressions at this granularity - never allocated by guessing.",
    requiresPermission: "view_analytics",
    parameters: {
      type: "object", additionalProperties: false, required: ["date_from", "date_to"],
      properties: { ...DATE_RANGE_PARAMS, attribution_model: { type: "string", enum: ["first_touch", "last_touch", "first_paid_touch", "last_paid_touch"] } },
    },
  },
  {
    name: "get_lead_source_breakdown",
    description: "Counts of leads by source bucket (Meta Paid, Facebook Organic, Instagram Organic, Direct WhatsApp, Referral, Website/UTM, Manual, Unknown) for a date range.",
    requiresPermission: "view_analytics",
    parameters: { type: "object", additionalProperties: false, required: ["date_from", "date_to"], properties: { ...DATE_RANGE_PARAMS } },
  },
  {
    name: "get_whatsapp_analytics",
    description: "WhatsApp conversation-to-lead/customer conversion metrics for a date range.",
    requiresPermission: "view_analytics",
    parameters: { type: "object", additionalProperties: false, required: ["date_from", "date_to"], properties: { ...DATE_RANGE_PARAMS } },
  },
  {
    name: "get_touch_summary",
    description: "The raw attribution touchpoints (first/last/first-paid/last-paid) recorded for one specific conversation, lead, opportunity, or customer.",
    requiresPermission: "attribution.view",
    parameters: {
      type: "object", additionalProperties: false, required: ["target_type", "target_id"],
      properties: {
        target_type: { type: "string", enum: ["conversation", "lead", "opportunity", "customer"] },
        target_id: { type: "string", description: "UUID of the target entity." },
      },
    },
  },
  {
    name: "list_campaigns",
    description: "Lists Meta ad campaigns (name, status, objective, budget). No performance figures - use get_campaign_performance for that.",
    requiresPermission: "campaign.view",
    parameters: { type: "object", additionalProperties: false, properties: { status: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50 } } },
  },
  {
    name: "list_leads",
    description: "Lists leads with optional status/qualification/date filters.",
    requiresPermission: "lead.view",
    parameters: {
      type: "object", additionalProperties: false,
      properties: { status: { type: "string", enum: ["active", "converted", "lost"] }, qualification_status: { type: "string", enum: ["unqualified", "qualifying", "qualified", "not_qualified"] }, ...DATE_RANGE_PARAMS, limit: { type: "integer", minimum: 1, maximum: 50 } },
    },
  },
  {
    name: "list_opportunities",
    description: "Lists opportunities with optional status/date filters.",
    requiresPermission: "opportunity.view",
    parameters: { type: "object", additionalProperties: false, properties: { status: { type: "string", enum: ["open", "won", "lost"] }, ...DATE_RANGE_PARAMS, limit: { type: "integer", minimum: 1, maximum: 50 } } },
  },
  {
    name: "list_customers",
    description: "Lists customers (won opportunities that became customers) with optional date filters.",
    requiresPermission: "opportunity.view",
    parameters: { type: "object", additionalProperties: false, properties: { ...DATE_RANGE_PARAMS, limit: { type: "integer", minimum: 1, maximum: 50 } } },
  },
  {
    name: "list_integrations",
    description: "Connection status for each provider (Meta, WhatsApp) - never includes secrets or tokens.",
    requiresPermission: "integration.view",
    parameters: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "list_content",
    description: "Lists scheduled/published content posts with an optional status filter.",
    requiresPermission: "content.view",
    parameters: { type: "object", additionalProperties: false, properties: { status: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50 } } },
  },
];

const TOOL_NAMES = new Set(FLOW_AI_TOOLS.map((t) => t.name));

export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.has(name);
}

export class ToolArgumentError extends Error {}

// Maps a tool call to the underlying RPC name + argument shape. Deliberately
// a plain switch, not a generic "call whatever RPC the model names" - the
// model can only ever reach the RPCs enumerated here, with the exact
// argument names below, regardless of what it puts in a tool_call.
export async function dispatchTool(
  callerClient: AnySupabaseClient,
  workspaceId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  const int = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : fallback);

  switch (toolName) {
    case "get_analytics_kpis": {
      requireDateRange(args);
      return rpc(callerClient, "get_analytics_kpis", { p_workspace_id: workspaceId, p_date_from: args.date_from, p_date_to: args.date_to });
    }
    case "get_campaign_performance": {
      requireDateRange(args);
      return rpc(callerClient, "get_campaign_performance", {
        p_workspace_id: workspaceId, p_date_from: args.date_from, p_date_to: args.date_to,
        p_attribution_model: str(args.attribution_model) ?? "last_touch",
      });
    }
    case "get_creative_performance": {
      requireDateRange(args);
      return rpc(callerClient, "get_creative_performance", {
        p_workspace_id: workspaceId, p_date_from: args.date_from, p_date_to: args.date_to,
        p_attribution_model: str(args.attribution_model) ?? "last_touch",
      });
    }
    case "get_lead_source_breakdown": {
      requireDateRange(args);
      return rpc(callerClient, "get_lead_source_breakdown", { p_workspace_id: workspaceId, p_date_from: args.date_from, p_date_to: args.date_to });
    }
    case "get_whatsapp_analytics": {
      requireDateRange(args);
      return rpc(callerClient, "get_whatsapp_analytics", { p_workspace_id: workspaceId, p_date_from: args.date_from, p_date_to: args.date_to });
    }
    case "get_touch_summary": {
      const targetType = str(args.target_type);
      const targetId = str(args.target_id);
      if (!targetType || !["conversation", "lead", "opportunity", "customer"].includes(targetType) || !targetId) {
        throw new ToolArgumentError("get_touch_summary requires a valid target_type and target_id");
      }
      return rpc(callerClient, "get_touch_summary", { p_workspace_id: workspaceId, p_target_type: targetType, p_target_id: targetId });
    }
    case "list_campaigns":
      return rpc(callerClient, "ai_list_campaigns", { p_workspace_id: workspaceId, p_status: str(args.status), p_limit: int(args.limit, 20) });
    case "list_leads":
      return rpc(callerClient, "ai_list_leads", {
        p_workspace_id: workspaceId, p_status: str(args.status), p_qualification_status: str(args.qualification_status),
        p_date_from: str(args.date_from), p_date_to: str(args.date_to), p_limit: int(args.limit, 20),
      });
    case "list_opportunities":
      return rpc(callerClient, "ai_list_opportunities", {
        p_workspace_id: workspaceId, p_status: str(args.status), p_date_from: str(args.date_from), p_date_to: str(args.date_to), p_limit: int(args.limit, 20),
      });
    case "list_customers":
      return rpc(callerClient, "ai_list_customers", { p_workspace_id: workspaceId, p_date_from: str(args.date_from), p_date_to: str(args.date_to), p_limit: int(args.limit, 20) });
    case "list_integrations":
      return rpc(callerClient, "ai_list_integrations", { p_workspace_id: workspaceId });
    case "list_content":
      return rpc(callerClient, "ai_list_content", { p_workspace_id: workspaceId, p_status: str(args.status), p_limit: int(args.limit, 20) });
    default:
      throw new ToolArgumentError(`Unknown tool: ${toolName}`);
  }
}

function requireDateRange(args: Record<string, unknown>) {
  if (typeof args.date_from !== "string" || typeof args.date_to !== "string") {
    throw new ToolArgumentError("date_from and date_to are required ISO timestamps");
  }
}

async function rpc(callerClient: AnySupabaseClient, fn: string, params: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await callerClient.rpc(fn, params);
  if (error) throw new Error(`Tool RPC ${fn} failed: ${error.message}`);
  return data;
}

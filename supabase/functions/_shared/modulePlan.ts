// Server-side plan/module gate for edge functions. Uses the canonical
// evaluator (is_feature_enabled -> evaluate_feature_flags: plans, Admin
// workspace targets, grandfathering) - never plan names.
//
// requireModule() runs as the CALLER: for a non-member the evaluator raises,
// which is reported as a plain Forbidden, so a refusal never reveals another
// workspace's plan or existence. Call it after the function's own permission
// check and before any provider call, AI usage, allowance reservation or
// paid-resource write.
//
// modulesEnabledFor() is for service-role jobs (cron workers) that batch
// over many workspaces.
import type { AnySupabaseClient } from "./contentAuth.ts";

export type ModuleFlag =
  | "module.leads"
  | "module.customers"
  | "module.campaigns"
  | "module.content"
  | "module.creative_studio"
  | "module.automations"
  | "module.whatsapp"
  | "module.integrations"
  | "module.flow_ai";

export const MODULE_PLAN_MESSAGES: Record<ModuleFlag, string> = {
  "module.leads": "Leads are part of the Business and Growth plans. Upgrade in Billing & plans to use them.",
  "module.customers": "Customers are part of the Business and Growth plans. Upgrade in Billing & plans to use them.",
  "module.campaigns": "Campaigns are part of the Growth plan. Upgrade in Billing & plans to use them.",
  "module.content": "Content is part of the Business and Growth plans. Upgrade in Billing & plans to use it.",
  "module.creative_studio": "Creative Studio is part of the Growth plan. Upgrade in Billing & plans to use it.",
  "module.automations": "Automations are part of the Growth plan. Upgrade in Billing & plans to use them.",
  "module.whatsapp": "WhatsApp is part of the Growth plan. Upgrade in Billing & plans to use it.",
  "module.integrations": "Integrations are part of the Growth plan. Upgrade in Billing & plans to use them.",
  "module.flow_ai": "Flow AI is part of the Growth plan. Upgrade in Billing & plans to use it.",
};

export type ModuleRefusal = { status: 403; body: { error: string; code?: "MODULE_NOT_IN_PLAN" } };

/** null when the module is on for this workspace; otherwise the 403 to return. */
export async function requireModule(callerSb: AnySupabaseClient, workspaceId: string, flag: ModuleFlag): Promise<ModuleRefusal | null> {
  const { data, error } = await callerSb.rpc("is_feature_enabled", { p_workspace_id: workspaceId, p_flag_key: flag });
  if (error) return { status: 403, body: { error: "Forbidden" } };
  if (data !== true) return { status: 403, body: { error: MODULE_PLAN_MESSAGES[flag], code: "MODULE_NOT_IN_PLAN" } };
  return null;
}

/** Service-role batch check: the subset of workspaceIds with `flag` on. */
export async function modulesEnabledFor(serviceSb: AnySupabaseClient, workspaceIds: string[], flag: ModuleFlag): Promise<Set<string>> {
  const unique = Array.from(new Set(workspaceIds));
  const results = await Promise.all(unique.map(async (id) => {
    const { data, error } = await serviceSb.rpc("is_feature_enabled", { p_workspace_id: id, p_flag_key: flag });
    return !error && data === true ? id : null;
  }));
  return new Set(results.filter((id): id is string => id !== null));
}

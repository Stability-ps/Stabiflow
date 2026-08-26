import { admin } from "./helpers";

export async function seedPipeline(workspaceId: string, opts: { isDefault?: boolean; stageNames?: string[] } = {}) {
  const { data: pipeline, error } = await admin
    .from("pipelines")
    .insert({ workspace_id: workspaceId, name: "Test pipeline", is_default: opts.isDefault ?? false })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to seed pipeline: ${error.message}`);

  const stageNames = opts.stageNames ?? ["New", "Qualified"];
  const { data: stages, error: stageError } = await admin
    .from("pipeline_stages")
    .insert(stageNames.map((name, index) => ({ workspace_id: workspaceId, pipeline_id: pipeline.id, name, sort_order: index })))
    .select("id, name, sort_order");
  if (stageError) throw new Error(`Failed to seed pipeline stages: ${stageError.message}`);

  return { pipelineId: pipeline.id as string, stages: stages as { id: string; name: string; sort_order: number }[] };
}

export async function seedLead(workspaceId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("leads")
    .insert({ workspace_id: workspaceId, contact_name: "Test Lead", source: "manual", ...overrides })
    .select("*")
    .single();
  if (error) throw new Error(`Failed to seed lead: ${error.message}`);
  return data;
}

export async function seedOpportunity(workspaceId: string, leadId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("opportunities")
    .insert({ workspace_id: workspaceId, lead_id: leadId, title: "Test opportunity", ...overrides })
    .select("*")
    .single();
  if (error) throw new Error(`Failed to seed opportunity: ${error.message}`);
  return data;
}

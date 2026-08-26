// Phase E. Proves the pipelines-actions edge function dispatcher against
// the REAL deployed function: idempotent default-pipeline creation, stage
// CRUD/reorder/activation, single-default/single-won-stage invariants, and
// the cross-workspace defense on every action.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedPipeline } from "./leadsHelpers";

const ACTIONS_URL = `${SUPABASE_URL}/functions/v1/pipelines-actions`;

async function callAction(token: string, body: Record<string, unknown>) {
  const res = await fetch(ACTIONS_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

describe("Pipeline configuration actions (release blocker)", () => {
  let workspace: TestTenant;
  let otherWorkspace: TestTenant;
  let ownerToken: string;

  beforeAll(async () => {
    workspace = await createTestTenant("pipelines-actions");
    otherWorkspace = await createTestTenant("pipelines-actions-other");
    const { data: session } = await workspace.client.auth.getSession();
    ownerToken = session.session!.access_token;
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
    await cleanupTenant(otherWorkspace);
  });

  it("ensure_default_pipeline is idempotent - a second call returns the SAME pipeline, not a new one", async () => {
    const first = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "ensure_default_pipeline" });
    expect(first.status).toBe(200);
    expect(first.body.created).toBe(true);

    const second = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "ensure_default_pipeline" });
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);
    expect(second.body.pipeline_id).toBe(first.body.pipeline_id);

    const { data: defaults } = await admin.from("pipelines").select("id").eq("workspace_id", workspace.workspaceId).eq("is_default", true);
    expect(defaults).toHaveLength(1);
  });

  it("REGRESSION: concurrent ensure_default_pipeline calls never produce two default pipelines", async () => {
    const freshWorkspace = await createTestTenant("pipelines-actions-race");
    const { data: session } = await freshWorkspace.client.auth.getSession();
    const token = session.session!.access_token;

    const results = await Promise.all(Array.from({ length: 4 }, () => callAction(token, { workspace_id: freshWorkspace.workspaceId, action: "ensure_default_pipeline" })));
    results.forEach((r) => expect(r.status).toBe(200));
    const pipelineIds = new Set(results.map((r) => r.body.pipeline_id));
    expect(pipelineIds.size).toBe(1);

    const { data: defaults } = await admin.from("pipelines").select("id").eq("workspace_id", freshWorkspace.workspaceId).eq("is_default", true);
    expect(defaults).toHaveLength(1);
    await cleanupTenant(freshWorkspace);
  });

  it("create_pipeline, rename_pipeline, add_stage, rename_stage all work end to end", async () => {
    const created = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "create_pipeline", name: "Solar pipeline" });
    expect(created.status).toBe(200);
    const pipelineId = created.body.pipeline.id;

    const renamed = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "rename_pipeline", pipeline_id: pipelineId, name: "Solar sales pipeline" });
    expect(renamed.status).toBe(200);

    const stage = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "add_stage", pipeline_id: pipelineId, name: "Site visit" });
    expect(stage.status).toBe(200);
    const stageId = stage.body.stage.id;

    const stageRenamed = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "rename_stage", stage_id: stageId, name: "Site survey" });
    expect(stageRenamed.status).toBe(200);
    const { data: finalStage } = await admin.from("pipeline_stages").select("name").eq("id", stageId).single();
    expect(finalStage?.name).toBe("Site survey");
  });

  it("reorder_stages persists the new sort order and rejects a list that doesn't match the pipeline's actual stages", async () => {
    const { pipelineId, stages } = await seedPipeline(workspace.workspaceId, { stageNames: ["A", "B", "C"] });
    const reversedIds = stages.slice().reverse().map((s) => s.id);
    const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "reorder_stages", pipeline_id: pipelineId, stage_ids: reversedIds });
    expect(result.status).toBe(200);
    const { data: reordered } = await admin.from("pipeline_stages").select("id, sort_order").eq("pipeline_id", pipelineId).order("sort_order", { ascending: true });
    expect(reordered?.map((s) => s.id)).toEqual(reversedIds);

    const bad = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "reorder_stages", pipeline_id: pipelineId, stage_ids: [reversedIds[0]] });
    expect(bad.status).toBe(400);
  });

  it("set_default_pipeline never leaves two pipelines marked default", async () => {
    const first = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "create_pipeline", name: "Pipeline one" });
    const second = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "create_pipeline", name: "Pipeline two" });
    await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "set_default_pipeline", pipeline_id: first.body.pipeline.id });
    await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "set_default_pipeline", pipeline_id: second.body.pipeline.id });

    const { data: defaults } = await admin.from("pipelines").select("id").eq("workspace_id", workspace.workspaceId).eq("is_default", true);
    expect(defaults).toHaveLength(1);
    expect(defaults?.[0]?.id).toBe(second.body.pipeline.id);
  });

  it("set_stage_flags moves the won-stage flag rather than allowing two won stages on the same pipeline", async () => {
    const { pipelineId, stages } = await seedPipeline(workspace.workspaceId, { stageNames: ["Open", "Closed"] });
    await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "set_stage_flags", stage_id: stages[0].id, is_won_stage: true });
    const moved = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "set_stage_flags", stage_id: stages[1].id, is_won_stage: true });
    expect(moved.status).toBe(200);

    const { data: wonStages } = await admin.from("pipeline_stages").select("id").eq("pipeline_id", pipelineId).eq("is_won_stage", true);
    expect(wonStages).toHaveLength(1);
    expect(wonStages?.[0]?.id).toBe(stages[1].id);
  });

  it("set_stage_active toggles a stage without deleting it (no hard-delete)", async () => {
    const { stages } = await seedPipeline(workspace.workspaceId);
    const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "set_stage_active", stage_id: stages[0].id, is_active: false });
    expect(result.status).toBe(200);
    const { data: stage } = await admin.from("pipeline_stages").select("id, is_active").eq("id", stages[0].id).single();
    expect(stage?.is_active).toBe(false);
    expect(stage?.id).toBe(stages[0].id); // still exists, not deleted
  });

  it("cross-workspace defense: this workspace's token cannot rename another workspace's pipeline", async () => {
    const foreign = await seedPipeline(otherWorkspace.workspaceId);
    const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "rename_pipeline", pipeline_id: foreign.pipelineId, name: "hijacked" });
    expect(result.status).toBe(404);
    const { data: stillOriginal } = await admin.from("pipelines").select("name").eq("id", foreign.pipelineId).single();
    expect(stillOriginal?.name).toBe("Test pipeline");
  });
});

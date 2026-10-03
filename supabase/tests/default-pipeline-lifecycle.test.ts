// Pre-Phase-H correctness fix. Proves the default-pipeline lifecycle bug
// found during Phase G browser testing is actually fixed: a lead created
// via Inbox (create_from_conversation) or manually (create_manual) before
// anyone has ever visited /leads must still land on a real pipeline/stage,
// because create_workspace() now bootstraps the default pipeline
// atomically (20260906060000_default_pipeline_lifecycle_fix.sql) rather
// than depending on a client-side useEffect that has since been removed.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedPipeline, seedLead } from "./leadsHelpers";
import { seedInboxConversation, seedWhatsAppSetup } from "./inboxHelpers";

const PIPELINES_ACTIONS_URL = `${SUPABASE_URL}/functions/v1/pipelines-actions`;
const LEADS_ACTIONS_URL = `${SUPABASE_URL}/functions/v1/leads-actions`;
const DEFAULT_STAGE_NAMES = ["New", "Qualified", "Proposal", "Won"];

async function callPipelinesAction(token: string, body: Record<string, unknown>) {
  const res = await fetch(PIPELINES_ACTIONS_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

async function callLeadsAction(token: string, body: Record<string, unknown>) {
  const res = await fetch(LEADS_ACTIONS_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

describe("Default-pipeline lifecycle fix (release blocker)", () => {
  describe("workspace creation is atomic", () => {
    it("a newly created workspace immediately has exactly one default pipeline with the standard New/Qualified/Proposal/Won stages - no /leads visit, no explicit ensure_default_pipeline call", async () => {
      const workspace = await createTestTenant("pipeline-atomic-bootstrap");
      try {
        const { data: pipelines } = await admin.from("pipelines").select("id, name, is_default").eq("workspace_id", workspace.workspaceId);
        expect(pipelines).toHaveLength(1);
        expect(pipelines![0].is_default).toBe(true);
        expect(pipelines![0].name).toBe("Default pipeline");

        const { data: stages } = await admin.from("pipeline_stages").select("name, sort_order, is_won_stage").eq("pipeline_id", pipelines![0].id).order("sort_order", { ascending: true });
        expect(stages).toHaveLength(4);
        expect(stages!.map((s) => s.name)).toEqual(DEFAULT_STAGE_NAMES);
        expect(stages!.filter((s) => s.is_won_stage)).toHaveLength(1);
        expect(stages!.find((s) => s.is_won_stage)!.name).toBe("Won");
      } finally {
        await cleanupTenant(workspace);
      }
    });
  });

  describe("ensure_default_pipeline (defensive/recovery mechanism)", () => {
    let workspace: TestTenant;
    let ownerToken: string;

    beforeAll(async () => {
      workspace = await createTestTenant("pipeline-ensure-idempotent");
      const { data: session } = await workspace.client.auth.getSession();
      ownerToken = session.session!.access_token;
    });

    afterAll(async () => {
      await cleanupTenant(workspace);
    });

    it("REGRESSION: repeated initialization on a workspace that already has its bootstrap-created default creates no duplicates", async () => {
      const { data: existing } = await admin.from("pipelines").select("id").eq("workspace_id", workspace.workspaceId).eq("is_default", true).single();

      const first = await callPipelinesAction(ownerToken, { workspace_id: workspace.workspaceId, action: "ensure_default_pipeline" });
      expect(first.status).toBe(200);
      expect(first.body.created).toBe(false); // already existed from workspace creation itself
      expect(first.body.pipeline_id).toBe(existing!.id);

      const second = await callPipelinesAction(ownerToken, { workspace_id: workspace.workspaceId, action: "ensure_default_pipeline" });
      expect(second.body.created).toBe(false);
      expect(second.body.pipeline_id).toBe(existing!.id);

      const { data: defaults } = await admin.from("pipelines").select("id").eq("workspace_id", workspace.workspaceId).eq("is_default", true);
      expect(defaults).toHaveLength(1);
    });

    it("REGRESSION: concurrent initialization against a workspace with NO default pipeline (simulating the pre-fix state) never produces two defaults", async () => {
      // Simulate a workspace that predates the fix by removing its
      // bootstrap-created default (direct service-role delete - proving
      // the RECOVERY path, not the normal one).
      const { data: existing } = await admin.from("pipelines").select("id").eq("workspace_id", workspace.workspaceId).eq("is_default", true).single();
      await admin.from("pipelines").delete().eq("id", existing!.id);
      const { data: goneCheck } = await admin.from("pipelines").select("id").eq("workspace_id", workspace.workspaceId);
      expect(goneCheck).toHaveLength(0);

      const results = await Promise.all(Array.from({ length: 5 }, () => callPipelinesAction(ownerToken, { workspace_id: workspace.workspaceId, action: "ensure_default_pipeline" })));
      results.forEach((r) => expect(r.status).toBe(200));
      const pipelineIds = new Set(results.map((r) => r.body.pipeline_id));
      expect(pipelineIds.size).toBe(1);
      expect(results.filter((r) => r.body.created === true)).toHaveLength(1); // exactly one caller actually created it

      const { data: defaults } = await admin.from("pipelines").select("id").eq("workspace_id", workspace.workspaceId).eq("is_default", true);
      expect(defaults).toHaveLength(1);
      const { data: stages } = await admin.from("pipeline_stages").select("id").eq("pipeline_id", defaults![0].id);
      expect(stages).toHaveLength(4); // stages were recreated too, not left orphaned
    });
  });

  describe("lead creation defensively guarantees a pipeline/stage - before ANY /leads visit", () => {
    let workspace: TestTenant;
    let ownerToken: string;
    let numberId: string;

    beforeAll(async () => {
      workspace = await createTestTenant("lead-defensive-placement");
      const { data: session } = await workspace.client.auth.getSession();
      ownerToken = session.session!.access_token;
      const number = await seedWhatsAppSetup(workspace.workspaceId);
      numberId = number.id;
    });

    afterAll(async () => {
      await cleanupTenant(workspace);
    });

    it("manual lead creation (create_manual) lands on the default pipeline's first active ('New') stage", async () => {
      const result = await callLeadsAction(ownerToken, { workspace_id: workspace.workspaceId, action: "create_manual", contact_name: "Manual Test Lead", source: "manual" });
      expect(result.status).toBe(200);
      expect(result.body.lead.pipeline_id).toBeTruthy();
      expect(result.body.lead.pipeline_stage_id).toBeTruthy();

      const { data: pipeline } = await admin.from("pipelines").select("is_default").eq("id", result.body.lead.pipeline_id).single();
      expect(pipeline?.is_default).toBe(true);
      const { data: stage } = await admin.from("pipeline_stages").select("name, sort_order").eq("id", result.body.lead.pipeline_stage_id).single();
      expect(stage?.name).toBe("New"); // the expected Kanban stage - the first one
      expect(stage?.sort_order).toBe(0);
    });

    it("Inbox 'Create Lead' (create_from_conversation) lands on the default pipeline's first active ('New') stage", async () => {
      const conversation = await seedInboxConversation(workspace.workspaceId, numberId, { display_name: "Inbox Test Lead", phone_number: "+27831234567", wa_id: "27831234567" });
      const result = await callLeadsAction(ownerToken, { workspace_id: workspace.workspaceId, action: "create_from_conversation", conversation_id: conversation.id });
      expect(result.status).toBe(200);
      expect(result.body.lead.pipeline_id).toBeTruthy();
      expect(result.body.lead.pipeline_stage_id).toBeTruthy();

      const { data: stage } = await admin.from("pipeline_stages").select("name").eq("id", result.body.lead.pipeline_stage_id).single();
      expect(stage?.name).toBe("New");
    });

    it("this workspace still has exactly one default pipeline after multiple leads were created - no duplicate bootstrap from the defensive check", async () => {
      const { data: defaults } = await admin.from("pipelines").select("id").eq("workspace_id", workspace.workspaceId).eq("is_default", true);
      expect(defaults).toHaveLength(1);
    });
  });

  describe("backfill_lead_pipeline_placement (idempotent, workspace-scoped)", () => {
    let workspaceA: TestTenant;
    let workspaceB: TestTenant;

    beforeAll(async () => {
      workspaceA = await createTestTenant("backfill-a");
      workspaceB = await createTestTenant("backfill-b");
    });

    afterAll(async () => {
      await cleanupTenant(workspaceA);
      await cleanupTenant(workspaceB);
    });

    it("places a lead with a null pipeline_id into the default pipeline's first active stage", async () => {
      const lead = await seedLead(workspaceA.workspaceId, { pipeline_id: null, pipeline_stage_id: null });
      const { data: updatedCount, error } = await admin.rpc("backfill_lead_pipeline_placement", { p_workspace_id: workspaceA.workspaceId });
      expect(error).toBeNull();
      expect(updatedCount).toBeGreaterThanOrEqual(1);

      const { data: placed } = await admin.from("leads").select("pipeline_id, pipeline_stage_id").eq("id", lead.id).single();
      expect(placed!.pipeline_id).toBeTruthy();
      const { data: stage } = await admin.from("pipeline_stages").select("name").eq("id", placed!.pipeline_stage_id).single();
      expect(stage?.name).toBe("New");
    });

    it("REGRESSION: never overwrites a lead that already has a valid, possibly-custom pipeline placement", async () => {
      const { pipelineId, stages } = await seedPipeline(workspaceA.workspaceId, { stageNames: ["Custom A", "Custom B"] });
      const customLead = await seedLead(workspaceA.workspaceId, { pipeline_id: pipelineId, pipeline_stage_id: stages[1].id });

      await admin.rpc("backfill_lead_pipeline_placement", { p_workspace_id: workspaceA.workspaceId });

      const { data: unchanged } = await admin.from("leads").select("pipeline_id, pipeline_stage_id").eq("id", customLead.id).single();
      expect(unchanged!.pipeline_id).toBe(pipelineId);
      expect(unchanged!.pipeline_stage_id).toBe(stages[1].id);
    });

    it("REGRESSION: is idempotent - running it again after everything is already placed updates zero rows", async () => {
      const { data: updatedCount, error } = await admin.rpc("backfill_lead_pipeline_placement", { p_workspace_id: workspaceA.workspaceId });
      expect(error).toBeNull();
      expect(updatedCount).toBe(0);
    });

    it("REGRESSION: is workspace-scoped - never touches another workspace's unplaced leads", async () => {
      const leadB = await seedLead(workspaceB.workspaceId, { pipeline_id: null, pipeline_stage_id: null });
      await admin.rpc("backfill_lead_pipeline_placement", { p_workspace_id: workspaceA.workspaceId }); // scoped to A only
      const { data: stillUnplaced } = await admin.from("leads").select("pipeline_id").eq("id", leadB.id).single();
      expect(stillUnplaced!.pipeline_id).toBeNull(); // untouched by A's backfill call
    });
  });

  describe("tenant isolation is preserved", () => {
    it("REGRESSION: even a direct service-role write cannot place a lead onto another workspace's pipeline/stage - the pre-existing consistency trigger still fires", async () => {
      const workspaceA = await createTestTenant("pipeline-isolation-a");
      const workspaceB = await createTestTenant("pipeline-isolation-b");
      try {
        const { data: pipelineB } = await admin.from("pipelines").select("id").eq("workspace_id", workspaceB.workspaceId).eq("is_default", true).single();
        const { error } = await admin.from("leads").insert({ workspace_id: workspaceA.workspaceId, contact_name: "Cross-workspace attempt", source: "manual", pipeline_id: pipelineB!.id });
        expect(error).toBeTruthy();
        expect(error?.message).toMatch(/must belong to the same workspace/);
      } finally {
        await cleanupTenant(workspaceA);
        await cleanupTenant(workspaceB);
      }
    });

    it("REGRESSION: ensure_default_pipeline for workspace A can never resolve to workspace B's pipeline", async () => {
      const workspaceA = await createTestTenant("pipeline-isolation-c");
      const workspaceB = await createTestTenant("pipeline-isolation-d");
      try {
        const { data: session } = await workspaceA.client.auth.getSession();
        const tokenA = session.session!.access_token;
        const result = await callPipelinesAction(tokenA, { workspace_id: workspaceA.workspaceId, action: "ensure_default_pipeline" });
        expect(result.status).toBe(200);
        const { data: pipelineB } = await admin.from("pipelines").select("id").eq("workspace_id", workspaceB.workspaceId).eq("is_default", true).single();
        expect(result.body.pipeline_id).not.toBe(pipelineB!.id);
        const { data: resolved } = await admin.from("pipelines").select("workspace_id").eq("id", result.body.pipeline_id).single();
        expect(resolved!.workspace_id).toBe(workspaceA.workspaceId);
      } finally {
        await cleanupTenant(workspaceA);
        await cleanupTenant(workspaceB);
      }
    });
  });
});

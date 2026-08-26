// Phase E. Proves the required cross-tenant isolation properties for
// Leads/Pipelines/Opportunities/Customers - RLS for read/write access, and
// (durable rule #24) workspace-consistency triggers as defense-in-depth
// even against a DIRECT service-role write that bypasses RLS entirely.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, type TestTenant } from "./helpers";
import { seedInboxConversation, seedWhatsAppSetup } from "./inboxHelpers";
import { seedLead, seedOpportunity, seedPipeline } from "./leadsHelpers";

describe("Leads/Pipelines/Opportunities/Customers tenant isolation (release blocker)", () => {
  let workspaceA: TestTenant;
  let workspaceB: TestTenant;
  let pipelineB: { pipelineId: string; stages: { id: string; name: string }[] };
  let leadB: { id: string; workspace_id: string };
  let opportunityB: { id: string };
  let customerB: { id: string };

  beforeAll(async () => {
    workspaceA = await createTestTenant("leads-a");
    workspaceB = await createTestTenant("leads-b");
    pipelineB = await seedPipeline(workspaceB.workspaceId);
    leadB = await seedLead(workspaceB.workspaceId, { pipeline_id: pipelineB.pipelineId, pipeline_stage_id: pipelineB.stages[0].id });
    opportunityB = await seedOpportunity(workspaceB.workspaceId, leadB.id, { pipeline_id: pipelineB.pipelineId, pipeline_stage_id: pipelineB.stages[0].id });
    const { data: customer } = await admin.from("customers").insert({ workspace_id: workspaceB.workspaceId, lead_id: leadB.id, name: "Test Customer" }).select("id").single();
    customerB = customer!;
  });

  afterAll(async () => {
    await cleanupTenant(workspaceA);
    await cleanupTenant(workspaceB);
  });

  it("workspace A cannot read workspace B's leads", async () => {
    const { data, error } = await workspaceA.client.from("leads").select("*").eq("id", leadB.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("workspace A cannot UPDATE workspace B's lead, and it genuinely never changes", async () => {
    const { data } = await workspaceA.client.from("leads").update({ contact_name: "hijacked" }).eq("id", leadB.id).select();
    expect(data).toEqual([]);
    const { data: stillOriginal } = await admin.from("leads").select("contact_name").eq("id", leadB.id).single();
    expect(stillOriginal?.contact_name).toBe("Test Lead");
  });

  it("workspace A cannot read workspace B's pipeline", async () => {
    const { data, error } = await workspaceA.client.from("pipelines").select("*").eq("id", pipelineB.pipelineId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("workspace A cannot read workspace B's opportunities", async () => {
    const { data, error } = await workspaceA.client.from("opportunities").select("*").eq("id", opportunityB.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("workspace A cannot change workspace B's opportunity outcome (mark won)", async () => {
    const { data } = await workspaceA.client.from("opportunities").update({ status: "won", won_at: new Date().toISOString() }).eq("id", opportunityB.id).select();
    expect(data).toEqual([]);
    const { data: stillOpen } = await admin.from("opportunities").select("status").eq("id", opportunityB.id).single();
    expect(stillOpen?.status).toBe("open");
  });

  it("workspace A cannot read workspace B's customer", async () => {
    const { data, error } = await workspaceA.client.from("customers").select("*").eq("id", customerB.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("REGRESSION: even a DIRECT service-role assignment cannot make a lead's assigned_to a member of a DIFFERENT workspace", async () => {
    const { error } = await admin.from("leads").update({ assigned_to: workspaceA.userId }).eq("id", leadB.id);
    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/assigned_to must be a member/);
  });

  it("REGRESSION: even a DIRECT service-role update cannot move a lead into a DIFFERENT workspace's pipeline stage", async () => {
    const pipelineA = await seedPipeline(workspaceA.workspaceId);
    const { error } = await admin.from("leads").update({ pipeline_id: pipelineA.pipelineId, pipeline_stage_id: pipelineA.stages[0].id }).eq("id", leadB.id);
    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/pipeline_id must belong to the same workspace/);
  });

  it("REGRESSION: even a DIRECT service-role insert cannot create an opportunity against a DIFFERENT workspace's lead", async () => {
    const { error } = await admin.from("opportunities").insert({ workspace_id: workspaceA.workspaceId, lead_id: leadB.id, title: "cross-tenant attempt" });
    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/lead_id must belong to the same workspace/);
  });

  it("REGRESSION: even a DIRECT service-role insert cannot create a lead against a DIFFERENT workspace's conversation", async () => {
    // No real conversation needed here - any non-null uuid the workspace
    // doesn't own proves the trigger fires; a syntactically valid but
    // foreign/nonexistent id is the strongest case (fails the exists()
    // check either way).
    const { error } = await admin.from("leads").insert({
      workspace_id: workspaceA.workspaceId,
      contact_name: "cross-tenant attempt",
      source: "whatsapp",
      created_from_conversation_id: "00000000-0000-0000-0000-000000000000",
    });
    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/created_from_conversation_id must belong to the same workspace/);
  });

  it("REGRESSION: even a DIRECT service-role update cannot link a workspace A conversation to a DIFFERENT workspace's lead", async () => {
    const numberA = await seedWhatsAppSetup(workspaceA.workspaceId);
    const conversationA = await seedInboxConversation(workspaceA.workspaceId, numberA.id);
    const { error } = await admin.from("inbox_conversations").update({ lead_id: leadB.id }).eq("id", conversationA.id);
    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/lead_id must belong to the same workspace/);
  });
});

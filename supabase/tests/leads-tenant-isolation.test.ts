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

  // --- workspace_lead_counters: RLS enabled, no policies (Security Advisor
  // "RLS Disabled in Public" fix, 20260921060000) ------------------------
  // The table is internal bookkeeping - written only by the SECURITY
  // DEFINER next_lead_reference() via the leads BEFORE INSERT trigger. With
  // RLS on and no policies, NO direct client can read or write it (not even
  // its own workspace's user), while lead-number generation is unaffected.

  it("workspace_lead_counters is not directly readable by any authenticated client - not even its own workspace's", async () => {
    // leadB was seeded in beforeAll, so workspace B already has a counter row.
    const viaOwner = await workspaceB.client.from("workspace_lead_counters").select("*").eq("workspace_id", workspaceB.workspaceId);
    expect(viaOwner.error).toBeNull();
    expect(viaOwner.data).toEqual([]);

    const viaOther = await workspaceA.client.from("workspace_lead_counters").select("*").eq("workspace_id", workspaceB.workspaceId);
    expect(viaOther.error).toBeNull();
    expect(viaOther.data).toEqual([]);

    // The row genuinely exists (service role bypasses RLS).
    const { data: real } = await admin.from("workspace_lead_counters").select("last_value").eq("workspace_id", workspaceB.workspaceId).single();
    expect(Number(real!.last_value)).toBeGreaterThanOrEqual(1);
  });

  it("a direct authenticated client cannot tamper with workspace_lead_counters, and the value genuinely never changes", async () => {
    const { data: before } = await admin.from("workspace_lead_counters").select("last_value").eq("workspace_id", workspaceB.workspaceId).single();

    const upd = await workspaceB.client.from("workspace_lead_counters").update({ last_value: 999999 }).eq("workspace_id", workspaceB.workspaceId).select();
    expect(upd.data ?? []).toEqual([]);
    const del = await workspaceB.client.from("workspace_lead_counters").delete().eq("workspace_id", workspaceB.workspaceId).select();
    expect(del.data ?? []).toEqual([]);

    const { data: after } = await admin.from("workspace_lead_counters").select("last_value").eq("workspace_id", workspaceB.workspaceId).single();
    expect(after!.last_value).toBe(before!.last_value);
  });

  it("lead-number generation still works with RLS enabled on the counter", async () => {
    const pattern = /^LEAD-\d{6}$/;
    const first = await seedLead(workspaceA.workspaceId, { contact_name: "Counter Test 1" });
    expect(pattern.test(first.human_reference)).toBe(true);

    const second = await seedLead(workspaceA.workspaceId, { contact_name: "Counter Test 2" });
    expect(pattern.test(second.human_reference)).toBe(true);
    expect(second.human_reference).not.toBe(first.human_reference);

    const firstN = Number(first.human_reference.slice(5));
    const secondN = Number(second.human_reference.slice(5));
    expect(secondN).toBe(firstN + 1);

    const { data: counter } = await admin.from("workspace_lead_counters").select("last_value").eq("workspace_id", workspaceA.workspaceId).single();
    expect(Number(counter!.last_value)).toBe(secondN);
  });
});

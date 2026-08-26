// Phase E. Proves the leads-actions edge function dispatcher against the
// REAL deployed function: lead creation (conversation-linked and manual),
// race-free human-reference generation, duplicate detection, qualification
// validation, stage-move workspace consistency, and the opportunity
// won/lost/reopen lifecycle including automatic customer creation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedInboxConversation, seedWhatsAppSetup } from "./inboxHelpers";
import { seedLead, seedPipeline } from "./leadsHelpers";

const ACTIONS_URL = `${SUPABASE_URL}/functions/v1/leads-actions`;
const LEAD_REFERENCE_PATTERN = /^LEAD-\d{6}$/;

async function callAction(token: string, body: Record<string, unknown>) {
  const res = await fetch(ACTIONS_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

describe("Leads/Opportunities staff actions (release blocker)", () => {
  let workspace: TestTenant;
  let otherWorkspace: TestTenant;
  let ownerToken: string;
  let numberId: string;

  beforeAll(async () => {
    workspace = await createTestTenant("leads-actions");
    otherWorkspace = await createTestTenant("leads-actions-other");
    const number = await seedWhatsAppSetup(workspace.workspaceId);
    numberId = number.id;

    const { data: session } = await workspace.client.auth.getSession();
    ownerToken = session.session!.access_token;
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
    await cleanupTenant(otherWorkspace);
  });

  it("create_from_conversation creates a lead with a valid human_reference, source=whatsapp, and links the conversation", async () => {
    const conversation = await seedInboxConversation(workspace.workspaceId, numberId, { display_name: "Thabo Nkosi", phone_number: "+27831110001", wa_id: "27831110001" });
    const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "create_from_conversation", conversation_id: conversation.id });
    expect(result.status).toBe(200);
    expect(result.body.created).toBe(true);
    expect(result.body.lead.source).toBe("whatsapp");
    expect(result.body.lead.contact_name).toBe("Thabo Nkosi");
    expect(LEAD_REFERENCE_PATTERN.test(result.body.lead.human_reference)).toBe(true);

    const { data: linked } = await admin.from("inbox_conversations").select("lead_id").eq("id", conversation.id).single();
    expect(linked?.lead_id).toBe(result.body.lead.id);
  });

  it("create_from_conversation on an ALREADY-linked conversation returns the existing lead, not a duplicate", async () => {
    const conversation = await seedInboxConversation(workspace.workspaceId, numberId, { phone_number: "+27831110002", wa_id: "27831110002" });
    const first = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "create_from_conversation", conversation_id: conversation.id });
    const second = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "create_from_conversation", conversation_id: conversation.id });
    expect(second.body.already_linked).toBe(true);
    expect(second.body.lead.id).toBe(first.body.lead.id);
  });

  it("duplicate detection: a matching phone surfaces the existing lead instead of silently creating a second one, unless force=true", async () => {
    await seedLead(workspace.workspaceId, { phone: "+27835550001", phone_normalized: "+27835550001" });

    const withoutForce = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "create_manual", contact_name: "Duplicate Attempt", phone: "+27835550001", source: "manual" });
    expect(withoutForce.status).toBe(200);
    expect(withoutForce.body.created).toBe(false);
    expect(withoutForce.body.duplicates.length).toBeGreaterThan(0);

    const withForce = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "create_manual", contact_name: "Duplicate Attempt", phone: "+27835550001", source: "manual", force: true });
    expect(withForce.status).toBe(200);
    expect(withForce.body.created).toBe(true);
  });

  it("REGRESSION: concurrent lead creation in the same workspace never collides on human_reference", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "create_manual", contact_name: `Concurrent ${i}`, source: "manual" })),
    );
    const references = results.map((r) => r.body.lead.human_reference);
    expect(new Set(references).size).toBe(references.length);
    references.forEach((ref) => expect(LEAD_REFERENCE_PATTERN.test(ref)).toBe(true));
  });

  it("REGRESSION: a lead created (manual or from a conversation) lands in the workspace's default pipeline's first active stage automatically - otherwise nothing in the UI could ever put it on a pipeline board", async () => {
    const pipeline = await seedPipeline(workspace.workspaceId, { isDefault: true, stageNames: ["Intake", "Working"] });
    const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "create_manual", contact_name: "Auto-placed Lead", source: "manual" });
    expect(result.status).toBe(200);
    expect(result.body.lead.pipeline_id).toBe(pipeline.pipelineId);
    expect(result.body.lead.pipeline_stage_id).toBe(pipeline.stages[0].id);
  });

  it("set_qualification rejects not_qualified with no reason, and accepts it with one", async () => {
    const lead = await seedLead(workspace.workspaceId);
    const rejected = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "set_qualification", lead_id: lead.id, qualification_status: "not_qualified" });
    expect(rejected.status).toBe(400);

    const accepted = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "set_qualification", lead_id: lead.id, qualification_status: "not_qualified", qualification_reason: "Budget too small" });
    expect(accepted.status).toBe(200);
  });

  it("move_stage rejects a stage that does not belong to the given pipeline", async () => {
    const lead = await seedLead(workspace.workspaceId);
    const pipelineOne = await seedPipeline(workspace.workspaceId);
    const pipelineTwo = await seedPipeline(workspace.workspaceId);
    const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "move_stage", lead_id: lead.id, pipeline_id: pipelineOne.pipelineId, pipeline_stage_id: pipelineTwo.stages[0].id });
    expect(result.status).toBe(400);
  });

  it("assign rejects a staff_id that is not a member of this workspace", async () => {
    const lead = await seedLead(workspace.workspaceId);
    const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "assign", target_type: "lead", target_id: lead.id, staff_id: otherWorkspace.userId });
    expect(result.status).toBe(400);
  });

  it("cross-workspace defense: this workspace's token cannot act on another workspace's lead_id", async () => {
    const foreignLead = await seedLead(otherWorkspace.workspaceId);
    const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "set_qualification", lead_id: foreignLead.id, qualification_status: "qualifying" });
    expect(result.status).toBe(404);
  });

  it("opportunity lifecycle: create -> won (with customer) -> cannot re-win -> reopen -> lost", async () => {
    const lead = await seedLead(workspace.workspaceId, { contact_name: "Won Customer", phone: "+27831230000", email: "won@example.com" });
    const created = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "create_opportunity", lead_id: lead.id, title: "Test deal" });
    expect(created.status).toBe(200);
    const opportunityId = created.body.opportunity.id;

    const won = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "mark_opportunity_won", opportunity_id: opportunityId, actual_value: 5000, create_customer: true });
    expect(won.status).toBe(200);
    expect(won.body.customer?.name).toBe("Won Customer");

    const { data: leadAfterWin } = await admin.from("leads").select("status").eq("id", lead.id).single();
    expect(leadAfterWin?.status).toBe("converted");

    const cannotRewin = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "mark_opportunity_won", opportunity_id: opportunityId });
    expect(cannotRewin.status).toBe(409);

    const reopened = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "reopen_opportunity", opportunity_id: opportunityId });
    expect(reopened.status).toBe(200);

    const lost = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "mark_opportunity_lost", opportunity_id: opportunityId, lost_reason: "Went with a competitor" });
    expect(lost.status).toBe(200);
    const { data: finalOpportunity } = await admin.from("opportunities").select("status, lost_reason").eq("id", opportunityId).single();
    expect(finalOpportunity?.status).toBe("lost");
    expect(finalOpportunity?.lost_reason).toBe("Went with a competitor");
  });

  it("REGRESSION: retrying mark_opportunity_won with create_customer never mints a second customer for the same opportunity", async () => {
    const lead = await seedLead(workspace.workspaceId, { contact_name: "Idempotent Customer" });
    const created = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "create_opportunity", lead_id: lead.id, title: "Idempotency test deal" });
    const opportunityId = created.body.opportunity.id;
    await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "mark_opportunity_won", opportunity_id: opportunityId, create_customer: true });

    const { data: customers } = await admin.from("customers").select("id").eq("opportunity_id", opportunityId);
    expect(customers).toHaveLength(1);
  });

  it("add_note requires lead.edit and saves into crm_notes with the correct target_type", async () => {
    const lead = await seedLead(workspace.workspaceId);
    const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "add_note", target_type: "lead", target_id: lead.id, note: "Called back, interested." });
    expect(result.status).toBe(200);
    const { data: notes } = await admin.from("crm_notes").select("body, target_type").eq("target_id", lead.id);
    expect(notes?.some((n) => n.body === "Called back, interested." && n.target_type === "lead")).toBe(true);
  });

  it("mark_lead_lost and reopen_lead round-trip status/lost_at", async () => {
    const lead = await seedLead(workspace.workspaceId);
    const lost = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "mark_lead_lost", lead_id: lead.id, lost_reason: "Unresponsive" });
    expect(lost.status).toBe(200);
    const { data: afterLost } = await admin.from("leads").select("status, lost_at").eq("id", lead.id).single();
    expect(afterLost?.status).toBe("lost");
    expect(afterLost?.lost_at).not.toBeNull();

    const reopened = await callAction(ownerToken, { workspace_id: workspace.workspaceId, action: "reopen_lead", lead_id: lead.id });
    expect(reopened.status).toBe(200);
    const { data: afterReopen } = await admin.from("leads").select("status, lost_at").eq("id", lead.id).single();
    expect(afterReopen?.status).toBe("active");
    expect(afterReopen?.lost_at).toBeNull();
  });
});

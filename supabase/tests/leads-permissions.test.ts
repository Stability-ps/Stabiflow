// Phase E. lead.view/lead.edit/pipeline.view/opportunity.view are enforced
// by RLS via has_workspace_permission(), never role rank alone - marketing
// and sales are rank-peers, and this proves the SAME rank does not imply
// the SAME lead-editing access (sales can edit; marketing cannot).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTenant, createTestTenant, createTestUser, seedMembership, type TestTenant } from "./helpers";
import { seedLead, seedPipeline } from "./leadsHelpers";

describe("Leads/Pipelines/Opportunities permission matrix (release blocker)", () => {
  let workspace: TestTenant;
  let leadId: string;
  let pipelineId: string;
  let marketing: { userId: string; client: import("@supabase/supabase-js").SupabaseClient };
  let sales: { userId: string; client: import("@supabase/supabase-js").SupabaseClient };
  let viewer: { userId: string; client: import("@supabase/supabase-js").SupabaseClient };

  beforeAll(async () => {
    workspace = await createTestTenant("leads-perms");
    const lead = await seedLead(workspace.workspaceId);
    leadId = lead.id;
    const pipeline = await seedPipeline(workspace.workspaceId);
    pipelineId = pipeline.pipelineId;

    const marketingUser = await createTestUser("leads-perms-marketing");
    await seedMembership(workspace.workspaceId, marketingUser.userId, "marketing");
    marketing = marketingUser;

    const salesUser = await createTestUser("leads-perms-sales");
    await seedMembership(workspace.workspaceId, salesUser.userId, "sales");
    sales = salesUser;

    const viewerUser = await createTestUser("leads-perms-viewer");
    await seedMembership(workspace.workspaceId, viewerUser.userId, "viewer");
    viewer = viewerUser;
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
    await cleanupTenant({ userId: marketing.userId });
    await cleanupTenant({ userId: sales.userId });
    await cleanupTenant({ userId: viewer.userId });
  });

  it("marketing (rank-peer of sales) CAN view leads but CANNOT edit them", async () => {
    const { data: viewResult, error: viewError } = await marketing.client.from("leads").select("id").eq("id", leadId).maybeSingle();
    expect(viewError).toBeNull();
    expect(viewResult?.id).toBe(leadId);

    const { data: writeResult } = await marketing.client.from("leads").update({ contact_name: "hijacked" }).eq("id", leadId).select("id");
    expect(writeResult).toEqual([]);
  });

  it("sales CAN view and edit leads", async () => {
    const { data } = await sales.client.from("leads").update({ contact_name: "Renamed by sales" }).eq("id", leadId).select("id");
    expect(data).toHaveLength(1);
  });

  it("viewer CAN view the pipeline but CANNOT manage it (no client write policy exists for anyone below pipeline.manage)", async () => {
    const { data: viewResult, error: viewError } = await viewer.client.from("pipelines").select("id").eq("id", pipelineId).maybeSingle();
    expect(viewError).toBeNull();
    expect(viewResult?.id).toBe(pipelineId);

    const { data: writeResult } = await viewer.client.from("pipelines").update({ name: "hijacked" }).eq("id", pipelineId).select("id");
    expect(writeResult).toEqual([]);
  });

  it("the owner CAN manage the pipeline", async () => {
    const { data } = await workspace.client.from("pipelines").update({ name: "Renamed by owner" }).eq("id", pipelineId).select("id");
    expect(data).toHaveLength(1);
  });
});

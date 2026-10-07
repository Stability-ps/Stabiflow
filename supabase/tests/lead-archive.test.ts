// Lead archiving (20261024060000_lead_archive + leads-actions archive_lead /
// restore_lead), against LOCAL Supabase with real RLS, triggers and the
// served leads-actions function.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, createTestUser, seedMembership, enableModules, type TestTenant } from "./helpers";

let owner: TestTenant;
let other: TestTenant;
let leadId: string;

async function act(client: TestTenant["client"], body: Record<string, unknown>) {
  const { data, error } = await client.functions.invoke("leads-actions", { body });
  const status = (error as { context?: { status?: number } } | null)?.context?.status ?? 200;
  return { data, status };
}

beforeAll(async () => {
  owner = await createTestTenant("lead-archive-owner");
  await enableModules(owner.workspaceId, "module.leads");
  other = await createTestTenant("lead-archive-other");
  await enableModules(other.workspaceId, "module.leads");
  const { data } = await act(owner.client, { workspace_id: owner.workspaceId, action: "create_manual", contact_name: "Archive Test Lead", source: "manual", force: true });
  leadId = (data as { lead: { id: string } }).lead.id;
});

afterAll(async () => {
  await cleanupTenant(owner);
  await cleanupTenant(other);
});

describe("archive_lead / restore_lead", () => {
  it("archives a lead without deleting it, records who and when, and logs activity", async () => {
    const r = await act(owner.client, { workspace_id: owner.workspaceId, action: "archive_lead", lead_id: leadId });
    expect(r.status).toBe(200);
    const { data: lead } = await admin.from("leads").select("id, status, archived_at, archived_by").eq("id", leadId).single();
    expect(lead?.archived_at).toBeTruthy();
    expect(lead?.archived_by).toBe(owner.userId);
    expect(lead?.status).toBe("active");
    const { data: log } = await admin.from("workspace_activity_log").select("action").eq("target_id", leadId).eq("action", "lead_archived");
    expect(log?.length).toBe(1);
  });

  it("is idempotent", async () => {
    const r = await act(owner.client, { workspace_id: owner.workspaceId, action: "archive_lead", lead_id: leadId });
    expect((r.data as { unchanged?: boolean }).unchanged).toBe(true);
  });

  it("restores the lead", async () => {
    const r = await act(owner.client, { workspace_id: owner.workspaceId, action: "restore_lead", lead_id: leadId });
    expect(r.status).toBe(200);
    const { data: lead } = await admin.from("leads").select("archived_at, archived_by").eq("id", leadId).single();
    expect(lead?.archived_at).toBeNull();
    expect(lead?.archived_by).toBeNull();
  });

  it("cannot be done by a role without lead.delete (sales)", async () => {
    // A Free test workspace has one seat; allow a second for this role check.
    await admin.from("workspace_entitlement_overrides").upsert({ workspace_id: owner.workspaceId, entitlement_key: "team_seats", limit_value: 5, reason: "lead-archive test" }, { onConflict: "workspace_id,entitlement_key" });
    const sales = await createTestUser("lead-archive-sales");
    await seedMembership(owner.workspaceId, sales.userId, "sales");
    const r = await act(sales.client, { workspace_id: owner.workspaceId, action: "archive_lead", lead_id: leadId });
    expect(r.status).toBe(403);
  });

  it("cannot reach a lead in another workspace", async () => {
    const r = await act(other.client, { workspace_id: other.workspaceId, action: "archive_lead", lead_id: leadId });
    expect(r.status).toBe(404);
  });

  it("cannot be bypassed by updating archived_at directly through the API", async () => {
    const { error } = await owner.client.from("leads").update({ archived_at: new Date().toISOString() }).eq("id", leadId);
    expect(error?.message).toMatch(/Archive a lead with the Archive lead action/);
    const { data: lead } = await admin.from("leads").select("archived_at").eq("id", leadId).single();
    expect(lead?.archived_at).toBeNull();
  });

  it("cannot create a lead that is already archived", async () => {
    const { error } = await owner.client.from("leads").insert({ workspace_id: owner.workspaceId, contact_name: "x", source: "manual", archived_at: new Date().toISOString() });
    expect(error?.message).toMatch(/cannot be archived/);
  });

  it("hides archived leads from Flow AI's lead list", async () => {
    await act(owner.client, { workspace_id: owner.workspaceId, action: "archive_lead", lead_id: leadId });
    const { data } = await owner.client.rpc("ai_list_leads", { p_workspace_id: owner.workspaceId });
    expect((data ?? []).some((l: { id: string }) => l.id === leadId)).toBe(false);
  });
});

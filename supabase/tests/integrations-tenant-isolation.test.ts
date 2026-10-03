// Phase C instruction #40. RLS proof for the Integrations module -
// workspace_integrations plus the four provider-resource tables it owns.
// Most of these tables already had is_workspace_member()-based SELECT
// policies from Phase 3; what's new in Phase C is the switch from
// has_workspace_role('admin') to has_workspace_permission(..., 'integration.manage')
// for writes, and the workspace-consistency triggers - both proven here.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, type TestTenant } from "./helpers";
import { seedFacebookPage } from "./contentHelpers";
import { seedInstagramAccount, seedWhatsAppNumber, seedWorkspaceIntegration } from "./integrationHelpers";
import { seedMetaAdAccount } from "./campaignHelpers";

describe("Integrations tenant isolation (release blocker)", () => {
  let workspaceA: TestTenant;
  let workspaceB: TestTenant;
  let integrationAId: string;
  let integrationBId: string;
  let pageBId: string;
  let igBId: string;
  let adAccountBId: string;
  let whatsappBId: string;

  beforeAll(async () => {
    workspaceA = await createTestTenant("integrations-a");
    workspaceB = await createTestTenant("integrations-b");
    integrationAId = await seedWorkspaceIntegration(workspaceA.workspaceId, "meta", { status: "disconnected" });
    integrationBId = await seedWorkspaceIntegration(workspaceB.workspaceId);
    pageBId = await seedFacebookPage(workspaceB.workspaceId, integrationBId);
    igBId = await seedInstagramAccount(workspaceB.workspaceId, integrationBId);
    adAccountBId = await seedMetaAdAccount(workspaceB.workspaceId, integrationBId);
    whatsappBId = (await seedWhatsAppNumber(workspaceB.workspaceId, integrationBId)).id;
  });

  afterAll(async () => {
    await cleanupTenant(workspaceA);
    await cleanupTenant(workspaceB);
  });

  it("workspace A cannot read workspace B's workspace_integrations row", async () => {
    const { data } = await workspaceA.client.from("workspace_integrations").select("id").eq("id", integrationBId);
    expect(data).toEqual([]);
  });

  it("workspace A cannot update workspace B's workspace_integrations row (e.g. cannot flip its status)", async () => {
    const { data } = await workspaceA.client.from("workspace_integrations").update({ status: "disconnected" }).eq("id", integrationBId).select("id");
    expect(data).toEqual([]);
    const { data: unchanged } = await admin.from("workspace_integrations").select("status").eq("id", integrationBId).single();
    expect(unchanged!.status).toBe("connected");
  });

  it("workspace A cannot read workspace B's Facebook Pages", async () => {
    const { data } = await workspaceA.client.from("workspace_facebook_pages").select("id").eq("id", pageBId);
    expect(data).toEqual([]);
  });

  it("workspace A cannot read workspace B's Instagram accounts", async () => {
    const { data } = await workspaceA.client.from("workspace_instagram_accounts").select("id").eq("id", igBId);
    expect(data).toEqual([]);
  });

  it("workspace A cannot read workspace B's Meta ad accounts", async () => {
    const { data } = await workspaceA.client.from("workspace_meta_ad_accounts").select("id").eq("id", adAccountBId);
    expect(data).toEqual([]);
  });

  it("workspace A cannot read workspace B's WhatsApp numbers", async () => {
    const { data } = await workspaceA.client.from("workspace_whatsapp_numbers").select("id").eq("id", whatsappBId);
    expect(data).toEqual([]);
  });

  it("workspace A (owner) cannot activate/deactivate workspace B's Facebook Page", async () => {
    const { data } = await workspaceA.client.from("workspace_facebook_pages").update({ is_active: false }).eq("id", pageBId).select("id");
    expect(data).toEqual([]);
    const { data: unchanged } = await admin.from("workspace_facebook_pages").select("is_active").eq("id", pageBId).single();
    expect(unchanged!.is_active).toBe(true);
  });

  it("workspace A (owner) CAN read and manage its OWN integration (sanity check - RLS isn't blocking everyone)", async () => {
    const { data: readBack } = await workspaceA.client.from("workspace_integrations").select("id").eq("id", integrationAId).single();
    expect(readBack?.id).toBe(integrationAId);
    const { data: updated } = await workspaceA.client.from("workspace_integrations").update({ status: "disconnected" }).eq("id", integrationAId).select("id");
    expect(updated).toHaveLength(1);
  });

  describe("workspace-consistency triggers (instruction #21/#22)", () => {
    it("REGRESSION: a Facebook Page row cannot be inserted with a workspace_id that doesn't match its integration_id's workspace", async () => {
      const { error } = await admin.from("workspace_facebook_pages").insert({
        workspace_id: workspaceA.workspaceId, // mismatched on purpose
        integration_id: integrationBId, // belongs to workspace B
        page_id: `mismatch-${Date.now()}`,
        page_name: "Should never be created",
      });
      expect(error).toBeTruthy();
      expect(error!.code).toBe("23514");
    });

    it("an Instagram account cannot be inserted with a linked_facebook_page_id belonging to a different workspace", async () => {
      const { error } = await admin.from("workspace_instagram_accounts").insert({
        workspace_id: workspaceA.workspaceId,
        integration_id: integrationAId,
        ig_business_account_id: `mismatch-ig-${Date.now()}`,
        linked_facebook_page_id: pageBId, // belongs to workspace B
      });
      expect(error).toBeTruthy();
      expect(error!.code).toBe("23514");
    });

    it("a WhatsApp number cannot be inserted with a workspace_id that doesn't match its integration_id's workspace", async () => {
      const { error } = await admin.from("workspace_whatsapp_numbers").insert({
        workspace_id: workspaceA.workspaceId,
        integration_id: integrationBId,
        phone_number_id: `mismatch-phone-${Date.now()}`,
      });
      expect(error).toBeTruthy();
      expect(error!.code).toBe("23514");
    });
  });

  describe("provider-id uniqueness across workspaces (instruction #22)", () => {
    it("REGRESSION: the SAME Facebook Page id can never be connected to two different workspaces at once", async () => {
      const { data: existingPage } = await admin.from("workspace_facebook_pages").select("page_id").eq("id", pageBId).single();
      const { error } = await admin.from("workspace_facebook_pages").insert({
        workspace_id: workspaceA.workspaceId,
        integration_id: integrationAId,
        page_id: existingPage!.page_id, // already connected to workspace B
        page_name: "Collision attempt",
      });
      expect(error).toBeTruthy();
      expect(error!.code).toBe("23505");
    });

    it("the SAME WhatsApp phone_number_id can never be connected to two different workspaces at once - this is the exact invariant webhook routing depends on", async () => {
      const { error } = await admin.from("workspace_whatsapp_numbers").insert({
        workspace_id: workspaceA.workspaceId,
        integration_id: integrationAId,
        phone_number_id: (await admin.from("workspace_whatsapp_numbers").select("phone_number_id").eq("id", whatsappBId).single()).data!.phone_number_id,
      });
      expect(error).toBeTruthy();
      expect(error!.code).toBe("23505");
    });
  });
});

// Phase D. RLS + workspace-consistency proof for the Inbox module, mirroring
// the same rigor as integrations-tenant-isolation.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, type TestTenant } from "./helpers";
import { seedInboxConversation, seedInboxMessage, seedWhatsAppSetup } from "./inboxHelpers";
import { seedWorkspaceIntegration } from "./integrationHelpers";

describe("Inbox tenant isolation (release blocker)", () => {
  let workspaceA: TestTenant;
  let workspaceB: TestTenant;
  let numberA: { id: string };
  let numberB: { id: string };
  let conversationB: { id: string; wa_id: string };
  let messageB: string;

  beforeAll(async () => {
    workspaceA = await createTestTenant("inbox-a");
    workspaceB = await createTestTenant("inbox-b");
    numberA = await seedWhatsAppSetup(workspaceA.workspaceId);
    numberB = await seedWhatsAppSetup(workspaceB.workspaceId);
    conversationB = await seedInboxConversation(workspaceB.workspaceId, numberB.id);
    messageB = await seedInboxMessage(workspaceB.workspaceId, conversationB.id);
  });

  afterAll(async () => {
    await cleanupTenant(workspaceA);
    await cleanupTenant(workspaceB);
  });

  it("workspace A cannot read workspace B's conversations", async () => {
    const { data } = await workspaceA.client.from("inbox_conversations").select("id").eq("id", conversationB.id);
    expect(data).toEqual([]);
  });

  it("workspace A cannot read workspace B's messages", async () => {
    const { data } = await workspaceA.client.from("inbox_messages").select("id").eq("id", messageB);
    expect(data).toEqual([]);
  });

  it("workspace A (owner) cannot update workspace B's conversation (e.g. cannot resolve it)", async () => {
    const { data } = await workspaceA.client.from("inbox_conversations").update({ inbox_status: "resolved" }).eq("id", conversationB.id).select("id");
    expect(data).toEqual([]);
    const { data: unchanged } = await admin.from("inbox_conversations").select("inbox_status").eq("id", conversationB.id).single();
    expect(unchanged!.inbox_status).not.toBe("resolved");
  });

  it("workspace A (owner) CAN read and manage its own conversation (sanity check)", async () => {
    const conversationA = await seedInboxConversation(workspaceA.workspaceId, numberA.id);
    const { data: readBack } = await workspaceA.client.from("inbox_conversations").select("id").eq("id", conversationA.id).single();
    expect(readBack?.id).toBe(conversationA.id);
  });

  describe("workspace-consistency triggers", () => {
    it("REGRESSION: a conversation cannot be inserted with a workspace_id that doesn't match its whatsapp_number_id's workspace", async () => {
      const { error } = await admin.from("inbox_conversations").insert({
        workspace_id: workspaceA.workspaceId,
        whatsapp_number_id: numberB.id, // belongs to workspace B
        wa_id: `mismatch-${Date.now()}`,
        phone_number: "+27820000001",
      });
      expect(error).toBeTruthy();
      expect(error!.code).toBe("23514");
    });

    it("a message cannot be inserted with a workspace_id that doesn't match its conversation_id's workspace", async () => {
      const { error } = await admin.from("inbox_messages").insert({
        workspace_id: workspaceA.workspaceId,
        conversation_id: conversationB.id, // belongs to workspace B
        direction: "inbound",
        sender_type: "customer",
        content: "spoofed",
      });
      expect(error).toBeTruthy();
      expect(error!.code).toBe("23514");
    });
  });

  it("the same wa_id CAN have independent conversations under two different workspaces' numbers (not a collision)", async () => {
    const sameWaId = `shared-${Date.now()}`;
    const convoOnA = await seedInboxConversation(workspaceA.workspaceId, numberA.id, { wa_id: sameWaId });
    const convoOnB = await seedInboxConversation(workspaceB.workspaceId, numberB.id, { wa_id: sameWaId });
    expect(convoOnA.id).not.toBe(convoOnB.id);
  });

  it("REGRESSION: the same (whatsapp_number_id, wa_id) pair can never have two conversations", async () => {
    const waId = `dup-${Date.now()}`;
    await seedInboxConversation(workspaceA.workspaceId, numberA.id, { wa_id: waId });
    const { error } = await admin.from("inbox_conversations").insert({ workspace_id: workspaceA.workspaceId, whatsapp_number_id: numberA.id, wa_id: waId, phone_number: "+27820000002" });
    expect(error).toBeTruthy();
    expect(error!.code).toBe("23505");
  });
});

describe("Inbox provider tables reuse existing integration isolation (sanity)", () => {
  it("a whatsapp integration seeded for tenant-isolation purposes is itself workspace-scoped (regression guard against accidental cross-module leakage)", async () => {
    const workspace = await createTestTenant("inbox-integration-sanity");
    const integrationId = await seedWorkspaceIntegration(workspace.workspaceId, "whatsapp");
    const { data } = await admin.from("workspace_integrations").select("workspace_id").eq("id", integrationId).single();
    expect(data!.workspace_id).toBe(workspace.workspaceId);
    await cleanupTenant(workspace);
  });
});

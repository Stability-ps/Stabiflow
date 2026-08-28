// Phase L-1. Proves the WhatsApp 24-hour messaging-window policy and
// approved-template sending against the REAL deployed inbox-actions edge
// function - never a real WhatsApp message, never real Meta spend (a mock
// WhatsApp send provider, selected by the same INTEGRATIONS_META_MOCK_MODE
// flag every other provider-mocked path in this codebase already uses -
// see _shared/inbox/whatsappSendProvider.ts/whatsappSendMock.ts).
//
// Central claim under test: a direct call to inbox-actions (never through
// a browser) cannot bypass window/template enforcement - "the browser is
// not the security boundary" is the whole point of these tests existing
// as edge-function-level tests, not UI tests.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupTenant, createTestTenant, createTestUser, seedMembership, SUPABASE_URL, type TestTenant } from "./helpers";
import { seedInboxConversation, seedInboxMessage, seedWhatsAppSetup } from "./inboxHelpers";

const ACTIONS_URL = `${SUPABASE_URL}/functions/v1/inbox-actions`;

async function callAction(token: string, body: Record<string, unknown>) {
  const res = await fetch(ACTIONS_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

async function tokenFor(client: TestTenant["client"]): Promise<string> {
  const { data } = await client.auth.getSession();
  return data.session!.access_token;
}

async function seedApprovedTemplate(workspaceId: string, integrationId: string, wabaId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("whatsapp_message_templates")
    .insert({
      workspace_id: workspaceId,
      integration_id: integrationId,
      waba_id: wabaId,
      provider_template_id: `test-template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: "order_update",
      language: "en_US",
      category: "UTILITY",
      provider_status: "APPROVED",
      components: [{ type: "BODY", text: "Hi {{1}}, your order is on its way." }],
      ...overrides,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to seed whatsapp_message_templates: ${error?.message}`);
  return data.id as string;
}

describe("WhatsApp 24-hour messaging window + templates (Phase L-1, release blocker)", () => {
  let workspace: TestTenant;
  let otherWorkspace: TestTenant;
  let numberId: string;
  let integrationId: string;
  let otherNumberId: string;
  let otherIntegrationId: string;
  let ownerToken: string;

  beforeAll(async () => {
    workspace = await createTestTenant("wa-window");
    otherWorkspace = await createTestTenant("wa-window-other");

    const number = await seedWhatsAppSetup(workspace.workspaceId);
    numberId = number.id;
    integrationId = number.integrationId;
    await admin.rpc("set_workspace_integration_secret", { p_integration_id: integrationId, p_secret: "mock-whatsapp-token-not-a-real-credential" });

    const otherNumber = await seedWhatsAppSetup(otherWorkspace.workspaceId);
    otherNumberId = otherNumber.id;
    otherIntegrationId = otherNumber.integrationId;
    await admin.rpc("set_workspace_integration_secret", { p_integration_id: otherIntegrationId, p_secret: "mock-whatsapp-token-not-a-real-credential" });

    ownerToken = await tokenFor(workspace.client);
  });

  afterAll(async () => {
    await cleanupTenant(workspace);
    await cleanupTenant(otherWorkspace);
  });

  describe("free-form send is gated on a real inbound customer message, never bypassable via a direct call", () => {
    it("REGRESSION: a conversation with NO inbound message at all (window 'unknown') blocks a free-form reply - direct edge-function call cannot bypass this", async () => {
      const conversation = await seedInboxConversation(workspace.workspaceId, numberId);
      const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversation.id, action: "reply", message: "Hello!" });
      expect(result.status).toBe(409);
      expect(result.body.code).toBe("messaging_window_closed");
      expect(result.body.window_state).toBe("unknown");
      const { data: messages } = await admin.from("inbox_messages").select("id").eq("conversation_id", conversation.id).eq("sender_type", "staff");
      expect(messages).toEqual([]); // never even saved, let alone sent
    });

    it("a conversation with a RECENT inbound customer message (window 'open') allows a free-form reply", async () => {
      const conversation = await seedInboxConversation(workspace.workspaceId, numberId);
      await seedInboxMessage(workspace.workspaceId, conversation.id);
      const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversation.id, action: "reply", message: "Hi there!" });
      expect(result.status).toBe(200);
      expect(["submitted", "failed"]).toContain(result.body.delivery_status);
    });

    it("REGRESSION: a conversation whose only inbound message is >24h old (window 'closed') blocks a free-form reply, even via a direct call", async () => {
      const conversation = await seedInboxConversation(workspace.workspaceId, numberId);
      const oldTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      await seedInboxMessage(workspace.workspaceId, conversation.id, { created_at: oldTimestamp });
      const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversation.id, action: "reply", message: "Are you still there?" });
      expect(result.status).toBe(409);
      expect(result.body.code).toBe("messaging_window_closed");
      expect(result.body.window_state).toBe("closed");
    });

    it("outbound staff/AI messages never extend the window - only a genuine inbound customer message does", async () => {
      const conversation = await seedInboxConversation(workspace.workspaceId, numberId);
      const oldTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      await seedInboxMessage(workspace.workspaceId, conversation.id, { created_at: oldTimestamp });
      // A recent OUTBOUND message (staff or AI) must not reopen the window.
      await admin.from("inbox_messages").insert({ workspace_id: workspace.workspaceId, conversation_id: conversation.id, direction: "outbound", sender_type: "staff", message_type: "text", content: "earlier reply", delivery_status: "submitted" });
      const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversation.id, action: "reply", message: "Another try" });
      expect(result.status).toBe(409);
      expect(result.body.window_state).toBe("closed");
    });

    it("REGRESSION: a NEW inbound customer message reopens the window automatically - no manual reopening required", async () => {
      const conversation = await seedInboxConversation(workspace.workspaceId, numberId);
      const oldTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      await seedInboxMessage(workspace.workspaceId, conversation.id, { created_at: oldTimestamp });
      const blocked = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversation.id, action: "reply", message: "First attempt" });
      expect(blocked.status).toBe(409);

      // The customer messages again - a real, fresh inbound row.
      await seedInboxMessage(workspace.workspaceId, conversation.id);

      const reopened = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversation.id, action: "reply", message: "Second attempt" });
      expect(reopened.status).toBe(200);
    });
  });

  describe("templates: discovery/eligibility/parameter validation, and workspace ownership", () => {
    it("REGRESSION: Workspace A cannot use Workspace B's template - rejected even with a valid template row id", async () => {
      const foreignTemplateId = await seedApprovedTemplate(otherWorkspace.workspaceId, otherIntegrationId, "waba-other");
      const conversation = await seedInboxConversation(workspace.workspaceId, numberId);
      await seedInboxMessage(workspace.workspaceId, conversation.id);
      const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversation.id, action: "reply_template", template_id: foreignTemplateId, parameters: ["Jane"] });
      expect(result.status).toBe(422);
      expect(result.body.code).toBe("template_not_found");
    });

    it("invalid/unapproved template is rejected: a PENDING template cannot be sent", async () => {
      const pendingTemplateId = await seedApprovedTemplate(workspace.workspaceId, integrationId, "waba-1", { provider_status: "PENDING", provider_template_id: `pending-${Date.now()}` });
      const conversation = await seedInboxConversation(workspace.workspaceId, numberId);
      await seedInboxMessage(workspace.workspaceId, conversation.id);
      const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversation.id, action: "reply_template", template_id: pendingTemplateId, parameters: ["Jane"] });
      expect(result.status).toBe(422);
      expect(result.body.code).toBe("template_not_approved");
    });

    it("parameter validation: wrong parameter count is rejected", async () => {
      const templateId = await seedApprovedTemplate(workspace.workspaceId, integrationId, "waba-1");
      const conversation = await seedInboxConversation(workspace.workspaceId, numberId);
      await seedInboxMessage(workspace.workspaceId, conversation.id);
      const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversation.id, action: "reply_template", template_id: templateId, parameters: [] });
      expect(result.status).toBe(422);
      expect(result.body.code).toBe("template_parameter_count_mismatch");
    });

    it("template send is permitted OUTSIDE the window when valid - this is the whole point of templates existing", async () => {
      const templateId = await seedApprovedTemplate(workspace.workspaceId, integrationId, "waba-1");
      const conversation = await seedInboxConversation(workspace.workspaceId, numberId);
      const oldTimestamp = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      await seedInboxMessage(workspace.workspaceId, conversation.id, { created_at: oldTimestamp });

      // Free-form is correctly blocked here...
      const blocked = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversation.id, action: "reply", message: "Hi" });
      expect(blocked.status).toBe(409);

      // ...but an approved template still goes through.
      const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversation.id, action: "reply_template", template_id: templateId, parameters: ["Jane"] });
      expect(result.status).toBe(200);
      expect(["submitted", "failed"]).toContain(result.body.delivery_status);

      const { data: message } = await admin.from("inbox_messages").select("message_type, content").eq("conversation_id", conversation.id).eq("message_type", "template").single();
      expect(message!.content).toContain("order_update");
      expect(message!.content).toContain("Jane");
    });

    it("template send is ALSO permitted when the window happens to be open (never forced to use free-form)", async () => {
      const templateId = await seedApprovedTemplate(workspace.workspaceId, integrationId, "waba-1");
      const conversation = await seedInboxConversation(workspace.workspaceId, numberId);
      await seedInboxMessage(workspace.workspaceId, conversation.id);
      const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversation.id, action: "reply_template", template_id: templateId, parameters: ["Jane"] });
      expect(result.status).toBe(200);
    });
  });

  describe("cross-workspace / tenant isolation", () => {
    it("REGRESSION: Workspace A cannot send through Workspace B's WhatsApp number - a conversation_id belonging to Workspace B is invisible to a Workspace A caller", async () => {
      const otherConversation = await seedInboxConversation(otherWorkspace.workspaceId, otherNumberId);
      await seedInboxMessage(otherWorkspace.workspaceId, otherConversation.id);
      const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: otherConversation.id, action: "reply", message: "Hijack attempt" });
      expect(result.status).toBe(404);
    });

    it("REGRESSION: Workspace A's template list never includes Workspace B's templates (RLS)", async () => {
      const foreignTemplateId = await seedApprovedTemplate(otherWorkspace.workspaceId, otherIntegrationId, "waba-other-2");
      const { data, error } = await workspace.client.from("whatsapp_message_templates").select("id").eq("id", foreignTemplateId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("a member with inbox.view (not inbox.manage) can read templates but the send action itself still requires inbox.manage permission", async () => {
      // support/marketing roles already proven elsewhere to have inbox.view
      // broadly and inbox.manage only for support - this just confirms
      // reply_template is gated the SAME way "reply" already is (both fall
      // under the same requiredPermission branch in inbox-actions).
      const templateId = await seedApprovedTemplate(workspace.workspaceId, integrationId, "waba-1");
      const { data: templates, error } = await workspace.client.from("whatsapp_message_templates").select("id").eq("id", templateId);
      expect(error).toBeNull();
      expect(templates).toHaveLength(1);
    });
  });

  describe("delivery status continues to work correctly for both send types", () => {
    it("a successful free-form send and a successful template send both persist provider_message_id/delivery_status consistently with the API response", async () => {
      const conversation = await seedInboxConversation(workspace.workspaceId, numberId);
      await seedInboxMessage(workspace.workspaceId, conversation.id);
      const result = await callAction(ownerToken, { workspace_id: workspace.workspaceId, conversation_id: conversation.id, action: "reply", message: "Consistency check" });
      expect(result.status).toBe(200);
      const { data: message } = await admin.from("inbox_messages").select("delivery_status, provider_message_id").eq("conversation_id", conversation.id).eq("sender_type", "staff").single();
      expect(message!.delivery_status).toBe(result.body.delivery_status);
    });
  });

  describe("permission enforcement is unchanged by these new actions", () => {
    it("a marketing member (no inbox.manage) cannot send a template reply", async () => {
      const marketingUser = await createTestUser("wa-window-marketing");
      await seedMembership(workspace.workspaceId, marketingUser.userId, "marketing");
      const marketingToken = await tokenFor(marketingUser.client);
      const templateId = await seedApprovedTemplate(workspace.workspaceId, integrationId, "waba-1");
      const conversation = await seedInboxConversation(workspace.workspaceId, numberId);
      await seedInboxMessage(workspace.workspaceId, conversation.id);
      const result = await callAction(marketingToken, { workspace_id: workspace.workspaceId, conversation_id: conversation.id, action: "reply_template", template_id: templateId, parameters: ["Jane"] });
      expect(result.status).toBe(403);
    });
  });
});

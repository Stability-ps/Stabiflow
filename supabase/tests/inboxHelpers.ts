import { admin } from "./helpers";
import { seedWorkspaceIntegration, seedWhatsAppNumber } from "./integrationHelpers";

/** Seeds a connected WhatsApp integration + active number for a workspace in one call - the fixture almost every Inbox test needs first. Idempotent on the integration: a workspace can only ever have ONE 'whatsapp' workspace_integrations row (unique on workspace_id+provider), so a second call for the same workspace reuses it and just adds another number - exactly the "several numbers, one connection" shape production allows. */
export async function seedWhatsAppSetup(workspaceId: string, overrides: Record<string, unknown> = {}) {
  const { data: existing } = await admin.from("workspace_integrations").select("id").eq("workspace_id", workspaceId).eq("provider", "whatsapp").maybeSingle();
  const integrationId = existing?.id || (await seedWorkspaceIntegration(workspaceId, "whatsapp"));
  const number = await seedWhatsAppNumber(workspaceId, integrationId, overrides);
  return { integrationId, ...number };
}

export async function seedInboxConversation(workspaceId: string, whatsappNumberId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("inbox_conversations")
    .insert({
      workspace_id: workspaceId,
      whatsapp_number_id: whatsappNumberId,
      wa_id: `27${Date.now()}${Math.floor(Math.random() * 1000)}`,
      phone_number: "+27820000000",
      ...overrides,
    })
    .select("id, wa_id")
    .single();
  if (error || !data) throw new Error(`Failed to seed inbox_conversations: ${error?.message}`);
  return data as { id: string; wa_id: string };
}

export async function seedInboxMessage(workspaceId: string, conversationId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("inbox_messages")
    .insert({
      workspace_id: workspaceId,
      conversation_id: conversationId,
      direction: "inbound",
      sender_type: "customer",
      message_type: "text",
      content: "Test message",
      ...overrides,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to seed inbox_messages: ${error?.message}`);
  return data.id as string;
}

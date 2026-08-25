import { admin } from "./helpers";

export async function seedWorkspaceIntegration(workspaceId: string, provider: "meta" | "whatsapp" = "meta", overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("workspace_integrations")
    .insert({ workspace_id: workspaceId, provider, status: "connected", ...overrides })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to seed workspace_integrations: ${error?.message}`);
  return data.id as string;
}

export async function seedInstagramAccount(workspaceId: string, integrationId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("workspace_instagram_accounts")
    .insert({ workspace_id: workspaceId, integration_id: integrationId, ig_business_account_id: `ig-${Date.now()}${Math.floor(Math.random() * 10000)}`, username: "test_ig", ...overrides })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to seed workspace_instagram_accounts: ${error?.message}`);
  return data.id as string;
}

export async function seedWhatsAppNumber(workspaceId: string, integrationId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("workspace_whatsapp_numbers")
    .insert({
      workspace_id: workspaceId,
      integration_id: integrationId,
      phone_number_id: `phone-${Date.now()}${Math.floor(Math.random() * 10000)}`,
      display_phone_number: "+27 82 000 0000",
      ...overrides,
    })
    .select("id, phone_number_id")
    .single();
  if (error || !data) throw new Error(`Failed to seed workspace_whatsapp_numbers: ${error?.message}`);
  return data as { id: string; phone_number_id: string };
}

export async function seedOauthState(workspaceId: string, userId: string, overrides: Record<string, unknown> = {}) {
  const state = `test-state-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  const { error } = await admin.from("workspace_integration_oauth_states").insert({
    workspace_id: workspaceId,
    provider: "meta",
    state,
    user_id: userId,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    ...overrides,
  });
  if (error) throw new Error(`Failed to seed workspace_integration_oauth_states: ${error.message}`);
  return state;
}

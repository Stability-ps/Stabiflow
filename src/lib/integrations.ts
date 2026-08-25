import { supabase } from "@/integrations/supabase/client";

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const message = (data as { error?: string } | null)?.error || error.message || `${name} failed`;
    throw new Error(message);
  }
  if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
}

export type IntegrationProvider = "meta" | "whatsapp";

// Starts an OAuth connection: the caller must navigate the browser to the
// returned url directly (window.location.href = url), NOT fetch it - it's
// Meta's consent dialog, which redirects back to StabiFlow's OAuth
// callback edge function (never back through this frontend call).
export function startIntegrationConnect(workspaceId: string, provider: IntegrationProvider) {
  return invoke<{ url: string }>("integrations-oauth-start", { workspace_id: workspaceId, provider });
}

export type DiscoverySummary = {
  facebookPages: { discovered: number; new: number; collisions: number };
  instagramAccounts: { discovered: number; new: number; collisions: number };
  adAccounts: { discovered: number; new: number; collisions: number };
  whatsappNumbers: { discovered: number; new: number; collisions: number };
  collisionDetails: Array<{ table: string; providerId: string }>;
};

export function refreshIntegrationResources(workspaceId: string, provider: IntegrationProvider) {
  return invoke<{ ok: true; summary: DiscoverySummary }>("integrations-discover-resources", { workspace_id: workspaceId, provider });
}

export type IntegrationResourceHealth = { type: string; id: string; label: string; healthy: boolean; category?: string; message?: string };

export function checkIntegrationConnectionHealth(workspaceId: string, provider: IntegrationProvider) {
  return invoke<{ ok: true; integration: { connected: boolean; healthy?: boolean; status?: string }; resources: IntegrationResourceHealth[] }>(
    "integrations-connection-health",
    { workspace_id: workspaceId, provider },
  );
}

export function disconnectIntegration(workspaceId: string, provider: IntegrationProvider) {
  return invoke<{ ok: true }>("integrations-disconnect", { workspace_id: workspaceId, provider });
}

// --- Resource activation (direct table write - RLS via integration.manage
// is the authorization boundary, same "no edge function needed for a
// plain column toggle" pattern as content_series/ad_campaigns drafts).

export async function setResourceActive(table: "workspace_facebook_pages" | "workspace_instagram_accounts" | "workspace_meta_ad_accounts" | "workspace_whatsapp_numbers", id: string, isActive: boolean) {
  const { error } = await supabase.from(table).update({ is_active: isActive }).eq("id", id);
  if (error) throw new Error(error.message);
}

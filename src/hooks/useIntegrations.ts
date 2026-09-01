import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type WorkspaceIntegrationRow = {
  id: string;
  provider: "meta" | "whatsapp";
  status: "connected" | "disconnected" | "error";
  connected_at: string | null;
  disconnected_at: string | null;
  last_health_check_at: string | null;
  last_health_check_status: string | null;
  last_health_check_message: string | null;
  last_success_at: string | null;
  token_expires_at: string | null;
  // WhatsApp only: is the WABA subscribed to this app's webhook?
  // 'subscribed' | 'not_subscribed' | 'unknown' | 'error' | null.
  webhook_subscription_status: string | null;
  webhook_subscription_checked_at: string | null;
  webhook_subscription_detail: string | null;
};

export function useWorkspaceIntegrations(workspaceId: string | null) {
  return useQuery({
    queryKey: ["workspace-integrations", workspaceId],
    queryFn: async (): Promise<WorkspaceIntegrationRow[]> => {
      const { data, error } = await supabase
        .from("workspace_integrations")
        .select("id, provider, status, connected_at, disconnected_at, last_health_check_at, last_health_check_status, last_health_check_message, last_success_at, token_expires_at, webhook_subscription_status, webhook_subscription_checked_at, webhook_subscription_detail")
        .eq("workspace_id", workspaceId as string);
      if (error) throw new Error(error.message);
      return data as WorkspaceIntegrationRow[];
    },
    enabled: !!workspaceId,
  });
}

// Full resource lists (active AND inactive) for the Manage panel - distinct
// from src/hooks/useSocialDestinations.ts / useMetaAccountResources.ts,
// which deliberately filter to is_active-only for Content/Campaigns
// pickers. The Integrations page is where is_active gets SET, so it needs
// to see everything.

export function useAllFacebookPages(workspaceId: string | null) {
  return useQuery({
    queryKey: ["integrations-facebook-pages", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_facebook_pages")
        .select("id, page_id, page_name, is_active")
        .eq("workspace_id", workspaceId as string)
        .order("page_name", { ascending: true });
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!workspaceId,
  });
}

export function useAllInstagramAccounts(workspaceId: string | null) {
  return useQuery({
    queryKey: ["integrations-instagram-accounts", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_instagram_accounts")
        .select("id, ig_business_account_id, username, is_active, linked_facebook_page_id")
        .eq("workspace_id", workspaceId as string)
        .order("username", { ascending: true });
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!workspaceId,
  });
}

export function useAllMetaAdAccounts(workspaceId: string | null) {
  return useQuery({
    queryKey: ["integrations-meta-ad-accounts", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_meta_ad_accounts")
        .select("id, ad_account_id, name, currency, is_active")
        .eq("workspace_id", workspaceId as string)
        .order("name", { ascending: true });
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!workspaceId,
  });
}

export function useAllWhatsAppNumbers(workspaceId: string | null) {
  return useQuery({
    queryKey: ["integrations-whatsapp-numbers", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_whatsapp_numbers")
        .select("id, phone_number_id, display_phone_number, verified_name, quality_rating, platform_status, waba_id, is_active, intake_schema_id")
        .eq("workspace_id", workspaceId as string)
        .order("display_phone_number", { ascending: true });
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!workspaceId,
  });
}

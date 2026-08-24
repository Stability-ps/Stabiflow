import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Reads the workspace-scoped Meta account model tables from Phase 3
// (workspace_integrations / workspace_meta_ad_accounts /
// workspace_facebook_pages / workspace_instagram_accounts) - the Campaign
// Builder never infers "the one ad account"; it lists everything actually
// connected and requires an explicit choice (Phase 6 instruction #3).
export function useMetaIntegration(workspaceId: string | null) {
  return useQuery({
    queryKey: ["meta-integration", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_integrations")
        .select("id, status, last_health_check_at, last_health_check_status, last_health_check_message")
        .eq("workspace_id", workspaceId as string)
        .eq("provider", "meta")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!workspaceId,
  });
}

export function useMetaAdAccounts(workspaceId: string | null) {
  return useQuery({
    queryKey: ["meta-ad-accounts", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_meta_ad_accounts")
        .select("id, integration_id, ad_account_id, name, currency, is_active")
        .eq("workspace_id", workspaceId as string)
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!workspaceId,
  });
}

export function useMetaFacebookPages(workspaceId: string | null) {
  return useQuery({
    queryKey: ["meta-facebook-pages-for-ads", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_facebook_pages")
        .select("id, page_id, page_name, is_active")
        .eq("workspace_id", workspaceId as string)
        .eq("is_active", true);
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!workspaceId,
  });
}

export function useMetaInstagramAccounts(workspaceId: string | null) {
  return useQuery({
    queryKey: ["meta-instagram-accounts-for-ads", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_instagram_accounts")
        .select("id, ig_business_account_id, username, is_active")
        .eq("workspace_id", workspaceId as string)
        .eq("is_active", true);
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!workspaceId,
  });
}

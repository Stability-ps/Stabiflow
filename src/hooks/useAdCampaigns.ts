import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Workspace-scoped query key, matching the pattern established in
// useWorkspaceActivity.ts / useContentMediaAssets.ts.
export function useAdCampaigns(workspaceId: string | null) {
  return useQuery({
    queryKey: ["ad-campaigns", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_campaigns")
        .select("id, name, objective, status, provider_effective_status, budget_type, daily_budget_minor_units, lifetime_budget_minor_units, currency, start_at, end_at, ad_account_id, external_campaign_id, created_at, workspace_meta_ad_accounts(name, ad_account_id)")
        .eq("workspace_id", workspaceId as string)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!workspaceId,
  });
}

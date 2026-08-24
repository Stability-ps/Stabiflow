import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Campaign-level snapshots only (ad_set_id/ad_id null) - Phase 6's
// Builder always produces exactly one ad set/ad per campaign, so
// campaign-level metrics are the whole picture for now (see the schema
// migration's builder-UX note).
export function useAdCampaignMetrics(campaignId: string | null) {
  return useQuery({
    queryKey: ["ad-campaign-metrics", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_campaign_metrics")
        .select("*")
        .eq("campaign_id", campaignId as string)
        .is("ad_set_id", null)
        .is("ad_id", null)
        .order("date_start", { ascending: true });
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!campaignId,
  });
}

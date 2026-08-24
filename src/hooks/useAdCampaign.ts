import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useAdCampaign(campaignId: string | null) {
  return useQuery({
    queryKey: ["ad-campaign", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_campaigns")
        .select(
          "*, ad_creatives:draft_creative_id(*, content_media_assets(storage_path, title)), workspace_meta_ad_accounts(id, name, ad_account_id, currency), workspace_facebook_pages(id, page_name), workspace_instagram_accounts(id, username)",
        )
        .eq("id", campaignId as string)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!campaignId,
  });
}

export function useAdSetsAndAds(campaignId: string | null) {
  return useQuery({
    queryKey: ["ad-campaign-sets-ads", campaignId],
    queryFn: async () => {
      const { data: adSets, error: adSetsError } = await supabase.from("ad_sets").select("*").eq("campaign_id", campaignId as string);
      if (adSetsError) throw new Error(adSetsError.message);
      const adSetIds = (adSets || []).map((a) => a.id);
      const { data: ads, error: adsError } = adSetIds.length
        ? await supabase.from("ads").select("*, ad_creatives(*)").in("ad_set_id", adSetIds)
        : { data: [], error: null };
      if (adsError) throw new Error(adsError.message);
      return { adSets: adSets || [], ads: ads || [] };
    },
    enabled: !!campaignId,
  });
}

export function useCampaignActivity(campaignId: string | null) {
  return useQuery({
    queryKey: ["ad-campaign-activity", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_activity_log")
        .select("*")
        .eq("target_id", campaignId as string)
        .eq("target_type", "ad_campaign")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!campaignId,
  });
}

export function useCampaignPublishOperations(campaignId: string | null) {
  return useQuery({
    queryKey: ["ad-campaign-publish-operations", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_publish_operations")
        .select("*")
        .eq("campaign_id", campaignId as string)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!campaignId,
  });
}

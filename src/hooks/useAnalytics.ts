import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AttributionModel, MoneyByCurrency } from "@/lib/analytics";
import type { DateRange } from "@/lib/analyticsDate";

// Every hook below includes workspaceId AND the resolved date-range
// instants (plus attribution model, where relevant) in its query key - a
// workspace switch or a date-range/model change is a genuinely different
// query, never a stale one silently reused (Phase H requirement #17).
function rangeKey(range: DateRange | null) {
  return range ? [range.from.toISOString(), range.to.toISOString()] : [null, null];
}

export type AnalyticsKpis = {
  spend: MoneyByCurrency;
  conversations: number;
  leads: number;
  qualified_leads: number;
  opportunities: number;
  customers: number;
  revenue_total: MoneyByCurrency;
  revenue_attributed: MoneyByCurrency;
  revenue_unattributed: MoneyByCurrency;
};

export function useAnalyticsKpis(workspaceId: string | null, range: DateRange | null) {
  return useQuery({
    queryKey: ["analytics-kpis", workspaceId, ...rangeKey(range)],
    queryFn: async (): Promise<AnalyticsKpis> => {
      const { data, error } = await supabase.rpc("get_analytics_kpis", {
        p_workspace_id: workspaceId as string,
        p_date_from: range!.from.toISOString(),
        p_date_to: range!.to.toISOString(),
      }).single();
      if (error) throw new Error(error.message);
      return data as AnalyticsKpis;
    },
    enabled: !!workspaceId && !!range,
  });
}

export type CampaignPerformanceRow = {
  campaign_id: string;
  name: string;
  status: string;
  currency: string;
  spend_minor: number;
  impressions: number;
  reach: number;
  clicks: number;
  conversations: number;
  leads: number;
  qualified_leads: number;
  opportunities: number;
  customers: number;
  revenue: MoneyByCurrency;
};

export function useCampaignPerformance(workspaceId: string | null, range: DateRange | null, attributionModel: AttributionModel) {
  return useQuery({
    queryKey: ["analytics-campaign-performance", workspaceId, ...rangeKey(range), attributionModel],
    queryFn: async (): Promise<CampaignPerformanceRow[]> => {
      const { data, error } = await supabase.rpc("get_campaign_performance", {
        p_workspace_id: workspaceId as string,
        p_date_from: range!.from.toISOString(),
        p_date_to: range!.to.toISOString(),
        p_attribution_model: attributionModel,
      });
      if (error) throw new Error(error.message);
      return (data || []) as CampaignPerformanceRow[];
    },
    enabled: !!workspaceId && !!range,
  });
}

/** Single-campaign convenience wrapper for Campaign Detail - same RPC, same read model as /analytics, filtered client-side to one campaign so the two surfaces can never disagree. */
export function useSingleCampaignPerformance(workspaceId: string | null, campaignId: string | null, range: DateRange | null, attributionModel: AttributionModel) {
  const query = useCampaignPerformance(workspaceId, range, attributionModel);
  const row = query.data?.find((r) => r.campaign_id === campaignId) ?? null;
  return { ...query, data: row };
}

export type CreativePerformanceRow = {
  creative_id: string;
  campaign_id: string;
  campaign_name: string;
  primary_text: string | null;
  media_storage_path: string | null;
  conversations: number;
  leads: number;
  customers: number;
  revenue: MoneyByCurrency;
};

export function useCreativePerformance(workspaceId: string | null, range: DateRange | null, attributionModel: AttributionModel) {
  return useQuery({
    queryKey: ["analytics-creative-performance", workspaceId, ...rangeKey(range), attributionModel],
    queryFn: async (): Promise<CreativePerformanceRow[]> => {
      const { data, error } = await supabase.rpc("get_creative_performance", {
        p_workspace_id: workspaceId as string,
        p_date_from: range!.from.toISOString(),
        p_date_to: range!.to.toISOString(),
        p_attribution_model: attributionModel,
      });
      if (error) throw new Error(error.message);
      return (data || []) as CreativePerformanceRow[];
    },
    enabled: !!workspaceId && !!range,
  });
}

export type SourceBreakdownRow = { source_label: string; lead_count: number };

export function useLeadSourceBreakdown(workspaceId: string | null, range: DateRange | null) {
  return useQuery({
    queryKey: ["analytics-lead-sources", workspaceId, ...rangeKey(range)],
    queryFn: async (): Promise<SourceBreakdownRow[]> => {
      const { data, error } = await supabase.rpc("get_lead_source_breakdown", {
        p_workspace_id: workspaceId as string,
        p_date_from: range!.from.toISOString(),
        p_date_to: range!.to.toISOString(),
      });
      if (error) throw new Error(error.message);
      return (data || []) as SourceBreakdownRow[];
    },
    enabled: !!workspaceId && !!range,
  });
}

export type WhatsAppAnalytics = {
  conversations_started: number;
  became_leads: number;
  became_qualified: number;
  became_customers: number;
  ai_reply_count: number;
  staff_reply_count: number;
};

export function useWhatsAppAnalytics(workspaceId: string | null, range: DateRange | null) {
  return useQuery({
    queryKey: ["analytics-whatsapp", workspaceId, ...rangeKey(range)],
    queryFn: async (): Promise<WhatsAppAnalytics> => {
      const { data, error } = await supabase.rpc("get_whatsapp_analytics", {
        p_workspace_id: workspaceId as string,
        p_date_from: range!.from.toISOString(),
        p_date_to: range!.to.toISOString(),
      }).single();
      if (error) throw new Error(error.message);
      return data as WhatsAppAnalytics;
    },
    enabled: !!workspaceId && !!range,
  });
}

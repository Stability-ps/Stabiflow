import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TouchKind = "first_touch" | "last_touch" | "first_paid_touch" | "last_paid_touch";
export type AttributionConfidence = "exact" | "high" | "medium" | "low" | "unknown";

export type TouchSummaryRow = {
  touch_kind: TouchKind;
  event_id: string;
  platform: string;
  source_type: string | null;
  source: string | null;
  occurred_at: string;
  campaign_id: string | null;
  ad_id: string | null;
  creative_id: string | null;
  attribution_confidence: AttributionConfidence | null;
};

export type AttributionTargetType = "conversation" | "lead" | "opportunity" | "customer";

/**
 * Reads the get_touch_summary() SQL function (first/last touch, first/last
 * paid touch) for one conversation/lead/opportunity/customer. Returns []
 * for a target with no attribution evidence at all - that is a fully
 * valid, non-error state (organic/manual/unknown), never treated as a
 * loading or error condition by callers.
 */
export function useTouchSummary(workspaceId: string | null, targetType: AttributionTargetType, targetId: string | null) {
  return useQuery({
    queryKey: ["attribution-touch-summary", workspaceId, targetType, targetId],
    queryFn: async (): Promise<TouchSummaryRow[]> => {
      const { data, error } = await supabase.rpc("get_touch_summary", {
        p_workspace_id: workspaceId as string,
        p_target_type: targetType,
        p_target_id: targetId as string,
      });
      if (error) throw new Error(error.message);
      return (data || []) as TouchSummaryRow[];
    },
    enabled: !!workspaceId && !!targetId,
  });
}

/**
 * Resolves human-readable campaign/ad/creative names for display alongside
 * a touch summary row - IDs alone aren't useful in the Lead/Opportunity
 * Attribution section. Every role that has attribution.view already has
 * campaign.view too (see src/lib/permissions.ts), so this never fails on
 * a permission mismatch for a role that could see the touch summary itself.
 */
export function useAttributionNames(workspaceId: string | null, campaignId: string | null, adId: string | null, creativeId: string | null) {
  return useQuery({
    queryKey: ["attribution-names", workspaceId, campaignId, adId, creativeId],
    queryFn: async (): Promise<{ campaignName: string | null; adName: string | null; creativeText: string | null }> => {
      const [campaignRes, adRes, creativeRes] = await Promise.all([
        campaignId ? supabase.from("ad_campaigns").select("name").eq("id", campaignId).maybeSingle() : Promise.resolve({ data: null }),
        adId ? supabase.from("ads").select("name").eq("id", adId).maybeSingle() : Promise.resolve({ data: null }),
        creativeId ? supabase.from("ad_creatives").select("primary_text").eq("id", creativeId).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      return {
        campaignName: (campaignRes.data as { name: string } | null)?.name ?? null,
        adName: (adRes.data as { name: string } | null)?.name ?? null,
        creativeText: (creativeRes.data as { primary_text: string } | null)?.primary_text ?? null,
      };
    },
    enabled: !!workspaceId && !!(campaignId || adId || creativeId),
  });
}

// get_campaign_conversion_counts() (the underlying SQL function) is kept
// for the Phase G integration test that calls it directly - but Campaign
// Detail now reads conversions via useSingleCampaignPerformance
// (src/hooks/useAnalytics.ts), the same read model /analytics uses, so the
// two surfaces can never disagree. This hook wrapper had no remaining
// caller and was removed rather than left as dead code.

export type RevenueEventRow = {
  id: string;
  customer_id: string | null;
  opportunity_id: string | null;
  lead_id: string | null;
  amount_minor: number;
  currency: string;
  event_type: "sale" | "payment" | "contract_value" | "adjustment" | "refund";
  occurred_at: string;
  reference: string | null;
  created_at: string;
};

const REVENUE_COLUMNS = "id, customer_id, opportunity_id, lead_id, amount_minor, currency, event_type, occurred_at, reference, created_at";

/**
 * Revenue linked to ONE opportunity. Deliberately narrow (not "all revenue
 * for this workspace") - this phase's UI is a simple record/view on an
 * opportunity/customer, never a revenue dashboard.
 */
export function useRevenueEventsForOpportunity(workspaceId: string | null, opportunityId: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["revenue-events", "opportunity", workspaceId, opportunityId],
    queryFn: async (): Promise<RevenueEventRow[]> => {
      const { data, error } = await supabase
        .from("revenue_events")
        .select(REVENUE_COLUMNS)
        .eq("workspace_id", workspaceId as string)
        .eq("opportunity_id", opportunityId as string)
        .order("occurred_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data as RevenueEventRow[];
    },
    enabled: !!workspaceId && !!opportunityId,
  });

  useEffect(() => {
    if (!workspaceId || !opportunityId) return;
    const channel = supabase
      .channel(`revenue-events-opp-${opportunityId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "revenue_events", filter: `opportunity_id=eq.${opportunityId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["revenue-events", "opportunity", workspaceId, opportunityId] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId, opportunityId, queryClient]);

  return query;
}

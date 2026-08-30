import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { roleHasPermission } from "@/lib/permissions";
import type { AttributionModel } from "@/lib/analytics";
import type { CampaignJourneyRow, JourneyBreakdownRow } from "@/lib/campaignJourney";

// THE authoritative Campaign Journey data source: the get_campaign_journey
// RPC (one row) + get_campaign_journey_entities (paginated stage rows).
// Both use the SAME model-credited population as get_campaign_performance,
// so the funnel counts and the drill-down counts reconcile exactly. No raw
// attribution_events query in React any more.

export type CampaignJourneyData = {
  row: CampaignJourneyRow | null;
  canView: boolean;
  canSeeRevenue: boolean;
  isLoading: boolean;
  isError: boolean;
};

function asBreakdown(v: unknown): JourneyBreakdownRow[] {
  return Array.isArray(v) ? (v as JourneyBreakdownRow[]) : [];
}

export function useCampaignJourney(workspaceId: string | null, campaignId: string | null, model: AttributionModel): CampaignJourneyData {
  const { currentMembership } = useAuth();
  const role = currentMembership?.role;
  const canView = roleHasPermission(role, "attribution.view");
  const canSeeRevenue = roleHasPermission(role, "revenue.view");

  const q = useQuery({
    queryKey: ["campaign-journey", workspaceId, campaignId, model],
    enabled: !!workspaceId && !!campaignId && canView,
    queryFn: async (): Promise<CampaignJourneyRow | null> => {
      const { data, error } = await supabase.rpc("get_campaign_journey", {
        p_workspace_id: workspaceId as string,
        p_campaign_id: campaignId as string,
        p_attribution_model: model,
      });
      if (error) throw new Error(error.message);
      const rows = (data || []) as CampaignJourneyRow[];
      const r = rows[0];
      if (!r) return null;
      return {
        ...r,
        revenue: Array.isArray(r.revenue) ? r.revenue : [],
        adset_breakdown: asBreakdown(r.adset_breakdown),
        ad_breakdown: asBreakdown(r.ad_breakdown),
        creative_breakdown: asBreakdown(r.creative_breakdown),
      };
    },
  });

  return {
    row: q.data ?? null,
    canView,
    canSeeRevenue,
    isLoading: q.isLoading,
    isError: q.isError,
  };
}

// --- per-stage entity rows, truly paginated -------------------------------

export type JourneyStageParam = "conversation" | "lead" | "qualified_lead" | "opportunity" | "customer";

export type JourneyEntityRow = {
  entity_id: string;
  primary_label: string;
  secondary_label: string | null;
  status_label: string | null;
  occurred_at: string;
  attribution_method: string | null;
  attribution_confidence: string | null;
  lead_id: string | null;
  opportunity_id: string | null;
  customer_id: string | null;
  conversation_id: string | null;
};

export const JOURNEY_ENTITY_PAGE_SIZE = 25;

// Human names for the ad-set / ad / creative ids the journey RPC returns.
// Pure label lookup (RLS: campaign.view) - bounded to a campaign's own
// handful of ad sets/ads/creatives; NOT part of any count.
export function useCampaignJourneyNames(workspaceId: string | null, row: CampaignJourneyRow | null) {
  const adSetIds = [...new Set((row?.adset_breakdown ?? []).map((r) => r.id))];
  const adIds = [...new Set((row?.ad_breakdown ?? []).map((r) => r.id))];
  const creativeIds = [...new Set((row?.creative_breakdown ?? []).map((r) => r.id))];

  return useQuery({
    queryKey: ["campaign-journey-names", workspaceId, row?.campaign_id, adSetIds, adIds, creativeIds],
    enabled: !!workspaceId && (adSetIds.length > 0 || adIds.length > 0 || creativeIds.length > 0),
    queryFn: async () => {
      const [adSets, ads, creatives] = await Promise.all([
        adSetIds.length ? supabase.from("ad_sets").select("id, name").in("id", adSetIds) : Promise.resolve({ data: [], error: null }),
        adIds.length ? supabase.from("ads").select("id, name").in("id", adIds) : Promise.resolve({ data: [], error: null }),
        creativeIds.length ? supabase.from("ad_creatives").select("id, headline, primary_text").in("id", creativeIds) : Promise.resolve({ data: [], error: null }),
      ]);
      return {
        adSet: new Map(((adSets.data || []) as Array<{ id: string; name: string }>).map((r) => [r.id, r.name])),
        ad: new Map(((ads.data || []) as Array<{ id: string; name: string }>).map((r) => [r.id, r.name])),
        creative: new Map(
          ((creatives.data || []) as Array<{ id: string; headline: string | null; primary_text: string }>).map((r) => [
            r.id,
            (r.headline && r.headline.trim()) || r.primary_text.slice(0, 60),
          ]),
        ),
      };
    },
  });
}

export function useCampaignJourneyStageEntities(
  workspaceId: string | null,
  campaignId: string | null,
  stage: JourneyStageParam,
  model: AttributionModel,
  page: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["campaign-journey-entities", workspaceId, campaignId, stage, model, page],
    enabled: enabled && !!workspaceId && !!campaignId,
    queryFn: async (): Promise<JourneyEntityRow[]> => {
      const { data, error } = await supabase.rpc("get_campaign_journey_entities", {
        p_workspace_id: workspaceId as string,
        p_campaign_id: campaignId as string,
        p_stage: stage,
        p_attribution_model: model,
        p_limit: JOURNEY_ENTITY_PAGE_SIZE,
        p_offset: page * JOURNEY_ENTITY_PAGE_SIZE,
      });
      if (error) throw new Error(error.message);
      return (data || []) as JourneyEntityRow[];
    },
  });
}

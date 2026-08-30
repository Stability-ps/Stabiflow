import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { roleHasPermission } from "@/lib/permissions";
import { useSingleCampaignPerformance } from "@/hooks/useAnalytics";
import type { AttributionModel } from "@/lib/analytics";
import type { JourneyDrillRow, JourneyFunnel, JourneyStageKey } from "@/lib/campaignJourney";

// The all-time window Campaign Detail already uses for its conversions
// widget - the Journey has no date picker, so it reports every real
// touchpoint this campaign has ever produced.
const ALL_TIME_RANGE = { from: new Date(0), to: new Date(Date.now() + 86_400_000) };

// Hard cap on the per-campaign attribution_events pull. A single SMB
// campaign realistically has tens to low-hundreds of conversation-start
// touchpoints; this bound keeps a pathological campaign from loading
// thousands of rows into the browser. When hit, the UI says so (a Phase 2
// server RPC removes the cap).
const DRILL_ROW_CAP = 3000;

export type CampaignJourneyData = {
  funnel: JourneyFunnel | null;
  drillRows: JourneyDrillRow[];
  capped: boolean;
  names: {
    adSet: Map<string, string>;
    ad: Map<string, string>;
    creative: Map<string, string>;
  };
  canView: boolean;
  canSeeRevenue: boolean;
  isLoading: boolean;
  isError: boolean;
};

function uniqNonNull(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0))];
}

export function useCampaignJourney(workspaceId: string | null, campaignId: string | null, model: AttributionModel): CampaignJourneyData {
  const { currentMembership } = useAuth();
  const role = currentMembership?.role;
  const canView = roleHasPermission(role, "attribution.view");
  const canSeeRevenue = roleHasPermission(role, "revenue.view");

  const perf = useSingleCampaignPerformance(canView ? workspaceId : null, campaignId, ALL_TIME_RANGE, model);

  const drill = useQuery({
    queryKey: ["campaign-journey-drill", workspaceId, campaignId],
    enabled: !!workspaceId && !!campaignId && canView,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attribution_events")
        .select("attribution_method, ad_set_id, ad_id, creative_id, conversation_id, lead_id, opportunity_id, customer_id")
        .eq("workspace_id", workspaceId as string)
        .eq("campaign_id", campaignId as string)
        .limit(DRILL_ROW_CAP + 1);
      if (error) throw new Error(error.message);
      const rows = (data || []) as JourneyDrillRow[];
      const capped = rows.length > DRILL_ROW_CAP;
      return { rows: capped ? rows.slice(0, DRILL_ROW_CAP) : rows, capped };
    },
  });

  const drillRows = drill.data?.rows ?? [];

  const names = useQuery({
    queryKey: ["campaign-journey-names", workspaceId, campaignId, drillRows.length],
    enabled: !!workspaceId && drillRows.length > 0 && canView,
    queryFn: async () => {
      const adSetIds = uniqNonNull(drillRows.map((r) => r.ad_set_id));
      const adIds = uniqNonNull(drillRows.map((r) => r.ad_id));
      const creativeIds = uniqNonNull(drillRows.map((r) => r.creative_id));
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

  const perfRow = perf.data;
  const funnel: JourneyFunnel | null = perfRow
    ? {
        spend_minor: perfRow.spend_minor,
        currency: perfRow.currency,
        impressions: perfRow.impressions,
        reach: perfRow.reach,
        clicks: perfRow.clicks,
        conversations: perfRow.conversations,
        qualified_leads: perfRow.qualified_leads,
        leads: perfRow.leads,
        opportunities: perfRow.opportunities,
        customers: perfRow.customers,
        revenue: perfRow.revenue,
      }
    : null;

  return {
    funnel,
    drillRows,
    capped: drill.data?.capped ?? false,
    names: names.data ?? { adSet: new Map(), ad: new Map(), creative: new Map() },
    canView,
    canSeeRevenue,
    isLoading: perf.isLoading || drill.isLoading,
    isError: perf.isError || drill.isError,
  };
}

// --- per-stage entity details (lazy, only when a stage is expanded) --------

export type JourneyEntityRow = {
  id: string;
  primaryLabel: string;
  secondaryLabel: string | null;
  statusLabel: string | null;
  method: string | null;
  leadId: string | null;
  opportunityId: string | null;
  customerId: string | null;
  conversationId: string | null;
};

const ENTITY_STAGE_TABLE: Record<JourneyStageKey, "inbox_conversations" | "leads" | "opportunities" | "customers"> = {
  conversations: "inbox_conversations",
  qualified_leads: "leads",
  leads: "leads",
  opportunities: "opportunities",
  customers: "customers",
};

export function useCampaignJourneyStageEntities(
  workspaceId: string | null,
  stage: JourneyStageKey,
  entries: { id: string; method: string | null }[],
) {
  const ids = entries.map((e) => e.id);
  const methodById = new Map(entries.map((e) => [e.id, e.method]));
  const table = ENTITY_STAGE_TABLE[stage];

  return useQuery({
    queryKey: ["campaign-journey-stage-entities", workspaceId, stage, ids],
    enabled: !!workspaceId && ids.length > 0,
    queryFn: async (): Promise<JourneyEntityRow[]> => {
      const wid = workspaceId as string;
      // Cap the detail fetch; the panel paginates over `entries` itself.
      const pageIds = ids.slice(0, 100);
      if (table === "inbox_conversations") {
        const { data, error } = await supabase
          .from("inbox_conversations")
          .select("id, display_name, phone_number, inbox_status, lead_id")
          .eq("workspace_id", wid)
          .in("id", pageIds);
        if (error) throw new Error(error.message);
        return ((data || []) as Array<{ id: string; display_name: string | null; phone_number: string; inbox_status: string; lead_id: string | null }>).map((r) => ({
          id: r.id,
          primaryLabel: r.display_name || r.phone_number,
          secondaryLabel: r.phone_number,
          statusLabel: r.inbox_status,
          method: methodById.get(r.id) ?? null,
          leadId: r.lead_id,
          opportunityId: null,
          customerId: null,
          conversationId: r.id,
        }));
      }
      if (table === "leads") {
        const { data, error } = await supabase
          .from("leads")
          .select("id, human_reference, contact_name, company_name, qualification_status, status, created_from_conversation_id")
          .eq("workspace_id", wid)
          .in("id", pageIds);
        if (error) throw new Error(error.message);
        return ((data || []) as Array<{ id: string; human_reference: string; contact_name: string | null; company_name: string | null; qualification_status: string; status: string; created_from_conversation_id: string | null }>).map((r) => ({
          id: r.id,
          primaryLabel: r.contact_name || r.company_name || r.human_reference,
          secondaryLabel: r.human_reference,
          statusLabel: `${r.qualification_status} · ${r.status}`,
          method: methodById.get(r.id) ?? null,
          leadId: r.id,
          opportunityId: null,
          customerId: null,
          conversationId: r.created_from_conversation_id,
        }));
      }
      if (table === "opportunities") {
        const { data, error } = await supabase
          .from("opportunities")
          .select("id, title, status, lead_id")
          .eq("workspace_id", wid)
          .in("id", pageIds);
        if (error) throw new Error(error.message);
        return ((data || []) as Array<{ id: string; title: string; status: string; lead_id: string }>).map((r) => ({
          id: r.id,
          primaryLabel: r.title,
          secondaryLabel: null,
          statusLabel: r.status,
          method: methodById.get(r.id) ?? null,
          leadId: r.lead_id,
          opportunityId: r.id,
          customerId: null,
          conversationId: null,
        }));
      }
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, company_name, lead_id, opportunity_id")
        .eq("workspace_id", wid)
        .in("id", pageIds);
      if (error) throw new Error(error.message);
      return ((data || []) as Array<{ id: string; name: string; company_name: string | null; lead_id: string | null; opportunity_id: string | null }>).map((r) => ({
        id: r.id,
        primaryLabel: r.name,
        secondaryLabel: r.company_name,
        statusLabel: "customer",
        method: methodById.get(r.id) ?? null,
        leadId: r.lead_id,
        opportunityId: r.opportunity_id,
        customerId: r.id,
        conversationId: null,
      }));
    },
  });
}

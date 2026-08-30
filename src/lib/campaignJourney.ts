import { computeRoas, costPerOutcome, safeRate, summarizeCurrency, type MoneyByCurrency, type RoasResult } from "@/lib/analytics";

// Pure presentation logic for the Campaign Journey. No I/O.
//
// Every number here comes from ONE authoritative source - the
// get_campaign_journey RPC, whose crediting logic is identical to
// get_campaign_performance. The funnel counts, the direct/inferred split
// and the ad-set/ad/creative breakdown are all computed by that RPC over
// the SAME model-credited population, so they reconcile (direct+inferred =
// stage total; breakdown rows sum to <= stage total).
//
// `metricsAvailable === false` means Meta has never synced spend for this
// campaign: spend/clicks are rendered "Not synced yet" (NEVER "0"), and
// every cost-per-X / CAC / ROAS is "—". A measured 0 (metrics row exists,
// spend is 0) still renders "0" / "R0.00". The two states stay distinct
// (audit HIGH-4 / rule 16).

export type JourneyBreakdownRow = {
  id: string;
  conversations: number;
  leads: number;
  opportunities: number;
  customers: number;
};

/** One row from get_campaign_journey. */
export type CampaignJourneyRow = {
  campaign_id: string;
  name: string;
  status: string;
  currency: string;
  metrics_available: boolean;
  spend_minor: number;
  impressions: number;
  reach: number;
  clicks: number;
  conversations: number;
  conversations_direct: number;
  conversations_inferred: number;
  leads: number;
  leads_direct: number;
  leads_inferred: number;
  qualified_leads: number;
  opportunities: number;
  opportunities_direct: number;
  opportunities_inferred: number;
  customers: number;
  customers_direct: number;
  customers_inferred: number;
  revenue: MoneyByCurrency;
  adset_breakdown: JourneyBreakdownRow[];
  ad_breakdown: JourneyBreakdownRow[];
  creative_breakdown: JourneyBreakdownRow[];
};

export type JourneyFunnel = {
  metricsAvailable: boolean;
  spend_minor: number;
  currency: string;
  impressions: number;
  reach: number;
  clicks: number;
  conversations: number;
  qualified_leads: number;
  leads: number;
  opportunities: number;
  customers: number;
  revenue: MoneyByCurrency;
};

export function toFunnel(row: CampaignJourneyRow): JourneyFunnel {
  return {
    metricsAvailable: row.metrics_available,
    spend_minor: row.spend_minor,
    currency: row.currency,
    impressions: row.impressions,
    reach: row.reach,
    clicks: row.clicks,
    conversations: row.conversations,
    qualified_leads: row.qualified_leads,
    leads: row.leads,
    opportunities: row.opportunities,
    customers: row.customers,
    revenue: row.revenue,
  };
}

export type JourneyStageKey = "conversations" | "leads" | "qualified_leads" | "opportunities" | "customers";

export type BandSplit = { direct: number; inferred: number };

export type JourneyStage = {
  key: JourneyStageKey;
  label: string;
  count: number;
  /** spend / count, minor units - null when count is 0 OR metrics are unavailable */
  costPerMinor: number | null;
  /** % of the previous funnel stage - null when the previous stage is 0 */
  rateFromPrevious: number | null;
  /** the previous stage's human label, so the UI can say "of Leads" not "of prev." */
  previousLabel: string | null;
  /** direct / inferred split for this stage - null for Qualified (a state, not a touch population) */
  bands: BandSplit | null;
};

// ORDER: Conversations → Leads → Qualified → Opportunities → Customers.
// Qualified is a STATE of a lead, not a predecessor - its conversion is
// qualified / leads (audit M6).
const STAGE_DEFS: {
  key: JourneyStageKey;
  label: string;
  prev: JourneyStageKey | "clicks" | null;
}[] = [
  { key: "conversations", label: "Conversations", prev: "clicks" },
  { key: "leads", label: "Leads", prev: "conversations" },
  { key: "qualified_leads", label: "Qualified", prev: "leads" },
  { key: "opportunities", label: "Opportunities", prev: "leads" },
  { key: "customers", label: "Customers", prev: "opportunities" },
];

const PREV_LABEL: Record<string, string> = {
  clicks: "Clicks",
  conversations: "Conversations",
  leads: "Leads",
  qualified_leads: "Qualified",
  opportunities: "Opportunities",
};

export function buildJourneyStages(row: CampaignJourneyRow): JourneyStage[] {
  const f = toFunnel(row);
  const valueFor = (k: JourneyStageKey | "clicks"): number => (k === "clicks" ? f.clicks : f[k]);
  const spendForCost = f.metricsAvailable ? f.spend_minor : null;
  const bandsByKey: Record<JourneyStageKey, BandSplit | null> = {
    conversations: { direct: row.conversations_direct, inferred: row.conversations_inferred },
    leads: { direct: row.leads_direct, inferred: row.leads_inferred },
    qualified_leads: null,
    opportunities: { direct: row.opportunities_direct, inferred: row.opportunities_inferred },
    customers: { direct: row.customers_direct, inferred: row.customers_inferred },
  };
  return STAGE_DEFS.map((def) => {
    const count = f[def.key];
    const prevCount = def.prev ? valueFor(def.prev) : null;
    return {
      key: def.key,
      label: def.label,
      count,
      costPerMinor: spendForCost === null ? null : costPerOutcome(spendForCost, count),
      rateFromPrevious: prevCount === null ? null : safeRate(prevCount, count),
      previousLabel: def.prev ? PREV_LABEL[def.prev] : null,
      bands: bandsByKey[def.key],
    };
  });
}

export type JourneyHeadline = {
  costPerClickMinor: number | null;
  cacMinor: number | null;
  roas: RoasResult;
  conversationToCustomerRate: number | null;
  leadToCustomerRate: number | null;
  revenueTotal: ReturnType<typeof summarizeCurrency>;
};

export function journeyHeadline(row: CampaignJourneyRow): JourneyHeadline {
  const f = toFunnel(row);
  const spend = f.metricsAvailable ? f.spend_minor : null;
  return {
    costPerClickMinor: spend === null ? null : costPerOutcome(spend, f.clicks),
    cacMinor: spend === null ? null : costPerOutcome(spend, f.customers),
    // computeRoas returns {status:'unavailable', reason:'no_spend'} for a
    // non-positive / non-finite spend, which is exactly what we want when
    // metrics are unavailable.
    roas: computeRoas(spend ?? Number.NaN, f.currency, f.revenue),
    conversationToCustomerRate: safeRate(f.conversations, f.customers),
    leadToCustomerRate: safeRate(f.leads, f.customers),
    revenueTotal: summarizeCurrency(f.revenue),
  };
}

// --- attribution confidence banding -----------------------------------------
// Mirrors src/lib/attribution.ts's explainTouch() vocabulary and the
// _shared/attribution.ts writer.

export type AttributionBand = "direct" | "inferred" | "unattributed";

const DIRECT_METHODS = new Set(["deterministic", "exact_match"]);

export function attributionBand(method: string | null | undefined): AttributionBand {
  if (method == null) return "inferred";
  return DIRECT_METHODS.has(method) ? "direct" : "inferred";
}

export const BAND_LABEL: Record<AttributionBand, string> = {
  direct: "Direct",
  inferred: "Inferred",
  unattributed: "Unattributed",
};

export const BAND_EXPLANATION =
  "Direct: the Meta ad referral was matched to a campaign you published in StabiFlow. Inferred: an ad referral was present but could not be matched to a StabiFlow campaign (the ad may have been created outside this platform). Direct + Inferred always equals the stage total.";

export const BREAKDOWN_NOTE =
  "Rows are grouped by the ad set / ad / creative of each entity's model-credited touchpoint, so they reconcile with the funnel above. Entities whose credited touchpoint has no resolved ad set (e.g. a manual attribution override) are not shown here, so a row's counts can sum to less than the funnel total.";

export function hasAnyJourneyData(f: JourneyFunnel | null | undefined): boolean {
  if (!f) return false;
  return (
    (f.metricsAvailable && (f.spend_minor > 0 || f.clicks > 0)) ||
    f.conversations > 0 ||
    f.leads > 0 ||
    f.opportunities > 0 ||
    f.customers > 0 ||
    f.revenue.length > 0
  );
}

/** Rows without a resolved ad set/ad/creative: funnel stage total minus the sum of breakdown rows. Never negative. */
export function breakdownRemainder(stageTotal: number, rows: JourneyBreakdownRow[], key: keyof Omit<JourneyBreakdownRow, "id">): number {
  const sum = rows.reduce((n, r) => n + (r[key] || 0), 0);
  return Math.max(0, stageTotal - sum);
}

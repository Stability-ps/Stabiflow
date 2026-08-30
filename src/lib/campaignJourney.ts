import { computeRoas, costPerOutcome, safeRate, summarizeCurrency, type MoneyByCurrency, type RoasResult } from "@/lib/analytics";

// Pure presentation logic for the Campaign Journey. No I/O. Every derived
// metric is `number | null` where null means "not enough data to compute
// this" - NEVER a fabricated 0. The UI renders null as "—" and a real 0 as
// "0", so the two stay semantically distinct (audit rule 16).

export type JourneyFunnel = {
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

export type JourneyStageKey = "conversations" | "qualified_leads" | "leads" | "opportunities" | "customers";

export type JourneyStage = {
  key: JourneyStageKey;
  label: string;
  count: number;
  /** spend / count, minor units - null when count is 0 */
  costPerMinor: number | null;
  /** % of the previous funnel stage - null when the previous stage is 0 */
  rateFromPrevious: number | null;
};

const STAGE_DEFS: { key: JourneyStageKey; label: string; prev: JourneyStageKey | "clicks" | null }[] = [
  { key: "conversations", label: "Conversations", prev: "clicks" },
  { key: "qualified_leads", label: "Qualified", prev: "conversations" },
  { key: "leads", label: "Leads", prev: "conversations" },
  { key: "opportunities", label: "Opportunities", prev: "leads" },
  { key: "customers", label: "Customers", prev: "opportunities" },
];

export function buildJourneyStages(f: JourneyFunnel): JourneyStage[] {
  const valueFor = (k: JourneyStageKey | "clicks"): number => (k === "clicks" ? f.clicks : f[k]);
  return STAGE_DEFS.map((def) => {
    const count = f[def.key];
    const prevCount = def.prev ? valueFor(def.prev) : null;
    return {
      key: def.key,
      label: def.label,
      count,
      costPerMinor: costPerOutcome(f.spend_minor, count),
      rateFromPrevious: prevCount === null ? null : safeRate(prevCount, count),
    };
  });
}

export type JourneyHeadline = {
  /** spend / clicks, minor units - null when no clicks */
  costPerClickMinor: number | null;
  /** spend / customers (CAC), minor units - null when no customers */
  cacMinor: number | null;
  roas: RoasResult;
  /** overall conversation -> customer %, null when no conversations */
  conversationToCustomerRate: number | null;
  /** lead -> customer %, null when no leads */
  leadToCustomerRate: number | null;
  revenueTotal: ReturnType<typeof summarizeCurrency>;
};

export function journeyHeadline(f: JourneyFunnel): JourneyHeadline {
  return {
    costPerClickMinor: costPerOutcome(f.spend_minor, f.clicks),
    cacMinor: costPerOutcome(f.spend_minor, f.customers),
    roas: computeRoas(f.spend_minor, f.currency, f.revenue),
    conversationToCustomerRate: safeRate(f.conversations, f.customers),
    leadToCustomerRate: safeRate(f.leads, f.customers),
    revenueTotal: summarizeCurrency(f.revenue),
  };
}

// --- attribution confidence banding -----------------------------------------
// The crediting touchpoint's own attribution_method decides the band. This
// mirrors src/lib/attribution.ts's explainTouch() vocabulary and the
// _shared/attribution.ts writer: a Meta referral resolved to a campaign
// StabiFlow itself published is "direct"; a referral that was present but
// could not be matched is "inferred"; no evidence at all is "unattributed".

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
  "Direct: the Meta ad referral was matched to a campaign you published in StabiFlow. Inferred: an ad referral was present but could not be matched to a StabiFlow campaign (the ad may have been created outside this platform).";

export type BandSplit = { direct: number; inferred: number };

/** Tally a set of crediting rows into a direct/inferred split per stage. */
export function tallyBands(rows: { attribution_method: string | null }[]): BandSplit {
  let direct = 0;
  let inferred = 0;
  for (const r of rows) {
    if (attributionBand(r.attribution_method) === "direct") direct += 1;
    else inferred += 1;
  }
  return { direct, inferred };
}

// --- drill-down structure --------------------------------------------------

export type JourneyDrillRow = {
  attribution_method: string | null;
  ad_set_id: string | null;
  ad_id: string | null;
  creative_id: string | null;
  conversation_id: string | null;
  lead_id: string | null;
  opportunity_id: string | null;
  customer_id: string | null;
};

export type BreakdownRow = {
  id: string;
  conversations: number;
  leads: number;
  opportunities: number;
  customers: number;
};

/** Group crediting rows by ad_set / ad / creative into conversion-count breakdowns. */
export function breakdownBy(rows: JourneyDrillRow[], dim: "ad_set_id" | "ad_id" | "creative_id"): BreakdownRow[] {
  const byId = new Map<string, BreakdownRow>();
  const seen = { conv: new Set<string>(), lead: new Set<string>(), opp: new Set<string>(), cust: new Set<string>() };
  for (const r of rows) {
    const id = r[dim];
    if (!id) continue;
    let acc = byId.get(id);
    if (!acc) {
      acc = { id, conversations: 0, leads: 0, opportunities: 0, customers: 0 };
      byId.set(id, acc);
    }
    // Count each distinct entity once per group.
    if (r.conversation_id && !seen.conv.has(id + r.conversation_id)) { seen.conv.add(id + r.conversation_id); acc.conversations += 1; }
    if (r.lead_id && !seen.lead.has(id + r.lead_id)) { seen.lead.add(id + r.lead_id); acc.leads += 1; }
    if (r.opportunity_id && !seen.opp.has(id + r.opportunity_id)) { seen.opp.add(id + r.opportunity_id); acc.opportunities += 1; }
    if (r.customer_id && !seen.cust.has(id + r.customer_id)) { seen.cust.add(id + r.customer_id); acc.customers += 1; }
  }
  return [...byId.values()].sort((a, b) => b.conversations - a.conversations);
}

/** Distinct entity ids for one funnel stage, with each id's crediting method (last write wins - a stage entity has exactly one crediting touchpoint per model in the source query anyway). */
export function stageEntityIds(rows: JourneyDrillRow[], stage: JourneyStageKey): { id: string; method: string | null }[] {
  const col: keyof JourneyDrillRow =
    stage === "conversations" ? "conversation_id"
    : stage === "opportunities" ? "opportunity_id"
    : stage === "customers" ? "customer_id"
    : "lead_id"; // leads + qualified_leads both key off lead_id
  const map = new Map<string, string | null>();
  for (const r of rows) {
    const id = r[col];
    if (id && typeof id === "string") map.set(id, r.attribution_method);
  }
  return [...map.entries()].map(([id, method]) => ({ id, method }));
}

export function hasAnyJourneyData(f: JourneyFunnel | null | undefined): boolean {
  if (!f) return false;
  return f.spend_minor > 0 || f.clicks > 0 || f.conversations > 0 || f.leads > 0 || f.opportunities > 0 || f.customers > 0 || f.revenue.length > 0;
}

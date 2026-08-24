// Pure normalization of a Meta Marketing API insights row into the shape
// ad_campaign_metrics stores (Phase 6 instruction #18/#19). Kept separate
// from the sync edge function specifically so "insight normalization" is
// unit-testable per instruction #30, without a network call or a database.
//
// Meta returns spend/cpc/cpm as DECIMAL STRINGS in major currency units
// (e.g. "12.50"), never minor units - this is the one deliberate exception
// to "money is always minor units once it leaves a UI decimal input"
// (see adMoney.ts): here, money is ENTERING the system from the provider,
// and this function is the single place that converts it to minor units,
// matching the same rounding rule adMoney.convertDecimalToMinorUnits uses.
import type { InsightsRow } from "./ad-providers/types.ts";

export type NormalizedMetricRow = {
  date_start: string;
  date_stop: string;
  spend_minor_units: number;
  currency: string;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number | null;
  cpc_minor_units: number | null;
  cpm_minor_units: number | null;
  frequency: number | null;
  results: number | null;
  cost_per_result_minor_units: number | null;
};

// Which Meta `actions[].action_type` counts as "results" for a given
// objective - documented per instruction #18's "results where available".
// Awareness has no natural single result action (it optimizes for reach,
// not an action), so `results` stays null for it rather than guessing.
const RESULT_ACTION_TYPE_BY_OBJECTIVE: Record<string, string | null> = {
  OUTCOME_AWARENESS: null,
  OUTCOME_TRAFFIC: "link_click",
  OUTCOME_ENGAGEMENT: "post_engagement",
  OUTCOME_SALES: "link_click",
};

function toMinorUnits(decimalString: string | undefined): number {
  if (!decimalString) return 0;
  const value = Number(decimalString);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

function toMinorUnitsOrNull(decimalString: string | undefined): number | null {
  if (decimalString === undefined || decimalString === null || decimalString === "") return null;
  const value = Number(decimalString);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

function toNumberOrNull(value: string | undefined): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeInsightsRow(row: InsightsRow, objective: string): NormalizedMetricRow {
  const resultActionType = RESULT_ACTION_TYPE_BY_OBJECTIVE[objective] ?? null;
  const resultAction = resultActionType ? row.actions?.find((a) => a.action_type === resultActionType) : undefined;
  const results = resultAction ? Math.round(Number(resultAction.value)) : null;

  const costPerResultAction = resultActionType ? row.cost_per_action_type?.find((a) => a.action_type === resultActionType) : undefined;
  const costPerResultMinorUnits = costPerResultAction ? toMinorUnitsOrNull(costPerResultAction.value) : null;

  return {
    date_start: row.date_start,
    date_stop: row.date_stop,
    spend_minor_units: toMinorUnits(row.spend),
    currency: row.currency || "",
    impressions: row.impressions ? Math.round(Number(row.impressions)) : 0,
    reach: row.reach ? Math.round(Number(row.reach)) : 0,
    clicks: row.clicks ? Math.round(Number(row.clicks)) : 0,
    ctr: toNumberOrNull(row.ctr),
    cpc_minor_units: toMinorUnitsOrNull(row.cpc),
    cpm_minor_units: toMinorUnitsOrNull(row.cpm),
    frequency: toNumberOrNull(row.frequency),
    results: Number.isFinite(results as number) ? results : null,
    cost_per_result_minor_units: results !== null && results > 0 ? costPerResultMinorUnits ?? Math.round((toMinorUnits(row.spend)) / results) : null,
  };
}

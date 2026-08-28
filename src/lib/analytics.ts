// Phase H. Pure, unit-tested analytics calculation helpers - the ONE place
// conversion rates, cost-per-outcome, and ROAS eligibility are computed.
// Every SQL read model (get_analytics_kpis/get_campaign_performance/etc.)
// returns raw components; these functions decide, explicitly, whether a
// derived metric is safe to show - never silently dividing by zero, never
// summing across currencies, never implying a number where the
// precondition isn't met.
import { formatMoney } from "@/lib/adMoney";

export type MoneyByCurrency = { currency: string; amount_minor: number }[];

export type AttributionModel = "first_touch" | "last_touch" | "first_paid_touch" | "last_paid_touch";

export const ATTRIBUTION_MODELS: AttributionModel[] = ["first_touch", "last_touch", "first_paid_touch", "last_paid_touch"];

export const ATTRIBUTION_MODEL_LABELS: Record<AttributionModel, string> = {
  first_touch: "First touch",
  last_touch: "Last touch",
  first_paid_touch: "First paid touch",
  last_paid_touch: "Last paid touch",
};

// last_touch is the default because it best matches "what happened right
// before this person converted" - a reasonable, common default, NOT a
// claim that it is the universally correct model. Every model here is a
// deterministic, documented read over the same raw touchpoints; switching
// models never rewrites or discards any attribution_events row.
export const DEFAULT_ATTRIBUTION_MODEL: AttributionModel = "last_touch";

export const ATTRIBUTION_MODEL_DESCRIPTION =
  "Credits a conversion to a single campaign/ad/creative based on the selected model. First/last touch use every real touchpoint; first/last PAID touch only consider touchpoints with a known paid source. No model is \"more correct\" - they answer different questions.";

/** count(to)/count(from) as a percentage, or null when `from` is 0 (division by zero is never rendered as 0% or Infinity). */
export function safeRate(from: number, to: number): number | null {
  if (!Number.isFinite(from) || from <= 0) return null;
  return (to / from) * 100;
}

/** spendMinor / count, in minor units - null only when count is 0 (nothing to divide by). spendMinor of 0 with count > 0 is a legitimate, real zero cost. */
export function costPerOutcome(spendMinor: number, count: number): number | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  if (!Number.isFinite(spendMinor)) return null;
  return spendMinor / count;
}

/** Collapses a {currency, amount_minor}[] to a single {amount_minor, currency} when exactly one currency has a non-zero amount; null (empty array) means "no data at all"; a distinguishable "mixed" marker when 2+ currencies are present. */
export type CurrencyTotal =
  | { kind: "empty" }
  | { kind: "single"; currency: string; amountMinor: number }
  | { kind: "mixed"; currencies: string[] };

export function summarizeCurrency(rows: MoneyByCurrency): CurrencyTotal {
  if (rows.length === 0) return { kind: "empty" };
  if (rows.length === 1) return { kind: "single", currency: rows[0].currency, amountMinor: rows[0].amount_minor };
  return { kind: "mixed", currencies: rows.map((r) => r.currency) };
}

// workspaceCurrency is required, not defaulted - an "empty" total has no
// real per-row currency to preserve (there's no data at all), so the only
// currency-correct thing to show for it is the WORKSPACE's own configured
// currency, never a hardcoded "$0.00" that silently assumes USD for every
// tenant regardless of what they actually configured in Settings.
export function formatCurrencyTotal(total: CurrencyTotal, workspaceCurrency: string): string {
  if (total.kind === "empty") return formatMoney(0, workspaceCurrency);
  if (total.kind === "single") return formatMoney(total.amountMinor, total.currency);
  return `Mixed currencies (${total.currencies.join(", ")})`;
}

export function formatMoneyByCurrency(rows: MoneyByCurrency, workspaceCurrency: string): string {
  return formatCurrencyTotal(summarizeCurrency(rows), workspaceCurrency);
}

export type RoasResult =
  | { status: "unavailable"; reason: "no_spend" | "no_revenue" }
  | { status: "mixed_currency" }
  | { status: "ok"; value: number; currency: string };

/**
 * ROAS = attributed revenue / ad spend, shown ONLY when: spend > 0,
 * attributed revenue > 0, and the revenue is in a single currency that
 * matches the spend currency. Never silently converts currencies.
 */
export function computeRoas(spendMinor: number, spendCurrency: string, revenue: MoneyByCurrency): RoasResult {
  if (!Number.isFinite(spendMinor) || spendMinor <= 0) return { status: "unavailable", reason: "no_spend" };
  const nonZeroRevenue = revenue.filter((r) => r.amount_minor !== 0);
  if (nonZeroRevenue.length === 0) return { status: "unavailable", reason: "no_revenue" };
  if (nonZeroRevenue.length > 1) return { status: "mixed_currency" };
  const [only] = nonZeroRevenue;
  if (only.currency !== spendCurrency) return { status: "mixed_currency" };
  return { status: "ok", value: only.amount_minor / spendMinor, currency: only.currency };
}

export function formatRoas(result: RoasResult): string {
  if (result.status === "ok") return `${result.value.toFixed(2)}x`;
  if (result.status === "mixed_currency") return "Mixed currency";
  return result.reason === "no_spend" ? "No spend" : "No attributed revenue";
}

export type FunnelStageInput = { label: string; count: number };
export type FunnelStageResult = FunnelStageInput & { rateFromPrevious: number | null };

/** Stage-to-stage conversion rates for a linear funnel - null between any pair where the earlier stage is 0 (never a fabricated 0%/Infinity%). */
export function buildFunnel(stages: FunnelStageInput[]): FunnelStageResult[] {
  return stages.map((stage, i) => ({
    ...stage,
    rateFromPrevious: i === 0 ? null : safeRate(stages[i - 1].count, stage.count),
  }));
}

export function overallFunnelRate(stages: FunnelStageInput[]): number | null {
  if (stages.length < 2) return null;
  return safeRate(stages[0].count, stages[stages.length - 1].count);
}

export type SourceBreakdownRow = { label: string; count: number; percentage: number | null };

export function withSourcePercentages(rows: { label: string; count: number }[]): SourceBreakdownRow[] {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return rows.map((r) => ({ ...r, percentage: total > 0 ? (r.count / total) * 100 : null }));
}

/** Percentage change between two comparable numeric metrics - null when the earlier period is 0 (no "+Infinity%") or either value is missing. */
export function periodOverPeriodChange(previous: number | null | undefined, current: number | null | undefined): number | null {
  if (previous === null || previous === undefined || current === null || current === undefined) return null;
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

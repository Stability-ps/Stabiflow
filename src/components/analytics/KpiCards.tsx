import { Metric, type MetricState } from "@/components/ui/metric";
import type { AnalyticsKpis } from "@/hooks/useAnalytics";
import { costPerOutcome, formatMoneyByCurrency, periodOverPeriodChange, summarizeCurrency, type MoneyByCurrency } from "@/lib/analytics";
import { formatMoney } from "@/lib/adMoney";

function deltaNote(value: number | null) {
  if (value === null) return undefined;
  const positive = value >= 0;
  return (
    <span className={positive ? "font-medium text-success" : "font-medium text-destructive-strong"}>
      {positive ? "+" : ""}{value.toFixed(0)}% vs previous period
    </span>
  );
}

function countState(value: number | null, previous?: number | null): MetricState {
  if (value === null) return { kind: "no_data" };
  const note = previous !== undefined ? deltaNote(periodOverPeriodChange(previous, value)) : undefined;
  return value === 0 ? { kind: "zero", note } : { kind: "value", value: value.toLocaleString(), note };
}

// No money rows for the range is a measured zero in the workspace currency
// (formatMoneyByCurrency already renders it that way), not missing data.
function moneyState(value: MoneyByCurrency, workspaceCurrency: string): MetricState {
  const total = summarizeCurrency(value);
  const display = formatMoneyByCurrency(value, workspaceCurrency);
  if (total.kind === "empty" || (total.kind === "single" && total.amountMinor === 0)) return { kind: "zero", value: display };
  return { kind: "value", value: display, note: total.kind === "mixed" ? "Several currencies - not converted" : undefined };
}

/** Cost per outcome: no_data (never 0) unless BOTH spend and the outcome count are valid for a single currency - see costPerOutcome/summarizeCurrency. */
function costState(spend: MoneyByCurrency, count: number): MetricState {
  const total = summarizeCurrency(spend);
  if (total.kind === "single") {
    const cost = costPerOutcome(total.amountMinor, count);
    return cost === null ? { kind: "no_data", note: count === 0 ? "No outcomes this period" : undefined } : { kind: "value", value: formatMoney(cost, total.currency) };
  }
  if (total.kind === "mixed") return { kind: "value", value: "Mixed currency", note: "Spend is in several currencies" };
  // No spend rows at all, but real outcomes exist - a genuine zero cost.
  return count > 0 ? { kind: "zero", note: "No ad spend this period" } : { kind: "no_data", note: "No spend or outcomes" };
}

export function KpiCards({ kpis, previous, canSeeRevenue, workspaceCurrency }: { kpis: AnalyticsKpis; previous?: AnalyticsKpis; canSeeRevenue: boolean; workspaceCurrency: string }) {
  return (
    <section aria-label="Key metrics" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Ad spend" state={moneyState(kpis.spend, workspaceCurrency)} />
        <Metric label="Conversations" state={countState(kpis.conversations, previous?.conversations)} />
        <Metric label="Leads" state={countState(kpis.leads, previous?.leads)} />
        <Metric label="Qualified leads" state={countState(kpis.qualified_leads, previous?.qualified_leads)} />
        <Metric label="Opportunities" state={countState(kpis.opportunities, previous?.opportunities)} />
        <Metric label="Customers" state={countState(kpis.customers, previous?.customers)} />
        {canSeeRevenue && <Metric label="Recorded revenue" state={moneyState(kpis.revenue_total, workspaceCurrency)} />}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric label="Cost / conversation" state={costState(kpis.spend, kpis.conversations)} />
        <Metric label="Cost / lead" state={costState(kpis.spend, kpis.leads)} />
        <Metric label="Cost / qualified lead" state={costState(kpis.spend, kpis.qualified_leads)} />
        <Metric label="Cost / opportunity" state={costState(kpis.spend, kpis.opportunities)} />
        <Metric label="Cost / customer" state={costState(kpis.spend, kpis.customers)} />
      </div>
    </section>
  );
}

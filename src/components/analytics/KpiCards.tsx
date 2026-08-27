import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalyticsKpis } from "@/hooks/useAnalytics";
import { costPerOutcome, formatMoneyByCurrency, periodOverPeriodChange, summarizeCurrency, type MoneyByCurrency } from "@/lib/analytics";
import { formatMoney } from "@/lib/adMoney";

function Delta({ value }: { value: number | null }) {
  if (value === null) return null;
  const positive = value >= 0;
  return <span className={`ml-1.5 text-xs font-medium ${positive ? "text-emerald-600" : "text-red-600"}`}>{positive ? "+" : ""}{value.toFixed(0)}%</span>;
}

function Kpi({ label, value, previousValue, isMoney }: { label: string; value: number | MoneyByCurrency | null; previousValue?: number | null; isMoney?: boolean }) {
  let display: string;
  if (isMoney) {
    display = formatMoneyByCurrency(value as MoneyByCurrency, "$0.00");
  } else if (value === null) {
    display = "—";
  } else {
    display = String(value as number);
  }
  const delta = !isMoney && typeof value === "number" && previousValue !== undefined ? periodOverPeriodChange(previousValue, value) : null;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{display}<Delta value={delta} /></p>
      </CardContent>
    </Card>
  );
}

/** A cost-per-outcome card: null (not zero) unless BOTH spend and the outcome count are valid for a single currency - see costPerOutcome/summarizeCurrency. */
function CostKpi({ label, spend, count }: { label: string; spend: MoneyByCurrency; count: number }) {
  const total = summarizeCurrency(spend);
  let display = "—";
  if (total.kind === "single") {
    const cost = costPerOutcome(total.amountMinor, count);
    display = cost === null ? "—" : formatMoney(cost, total.currency);
  } else if (total.kind === "mixed") {
    display = "Mixed currency";
  } else if (count > 0) {
    display = "0"; // no spend rows at all, but real outcomes exist - a genuine zero cost (no currency to format with, since nothing was ever spent)
  }
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent><p className="text-2xl font-semibold">{display}</p></CardContent>
    </Card>
  );
}

export function KpiCards({ kpis, previous, canSeeRevenue }: { kpis: AnalyticsKpis; previous?: AnalyticsKpis; canSeeRevenue: boolean }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Ad Spend" value={kpis.spend} isMoney />
        <Kpi label="Conversations" value={kpis.conversations} previousValue={previous?.conversations} />
        <Kpi label="Leads" value={kpis.leads} previousValue={previous?.leads} />
        <Kpi label="Qualified Leads" value={kpis.qualified_leads} previousValue={previous?.qualified_leads} />
        <Kpi label="Opportunities" value={kpis.opportunities} previousValue={previous?.opportunities} />
        <Kpi label="Customers" value={kpis.customers} previousValue={previous?.customers} />
        {canSeeRevenue && <Kpi label="Recorded Revenue" value={kpis.revenue_total} isMoney />}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <CostKpi label="Cost / Conversation" spend={kpis.spend} count={kpis.conversations} />
        <CostKpi label="Cost / Lead" spend={kpis.spend} count={kpis.leads} />
        <CostKpi label="Cost / Qualified Lead" spend={kpis.spend} count={kpis.qualified_leads} />
        <CostKpi label="Cost / Opportunity" spend={kpis.spend} count={kpis.opportunities} />
        <CostKpi label="Cost / Customer" spend={kpis.spend} count={kpis.customers} />
      </div>
    </div>
  );
}

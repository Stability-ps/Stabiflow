import { Metric } from "@/components/ui/metric";
import type { AnalyticsKpis } from "@/hooks/useAnalytics";
import { formatMoneyByCurrency } from "@/lib/analytics";

// revenue_total/attributed/unattributed all come straight from
// revenue_events (real recorded cash events) - never opportunities.
// actual_value, which is a separately-tracked deal value that this
// section deliberately does not relabel as revenue.
export function RevenueAnalyticsSection({ kpis, workspaceCurrency }: { kpis: AnalyticsKpis; workspaceCurrency: string }) {
  const money = (rows: AnalyticsKpis["revenue_total"]) => ({ kind: rows.length ? "value" : "zero", value: formatMoneyByCurrency(rows, workspaceCurrency) }) as const;
  return (
    <section aria-labelledby="analytics-revenue" className="space-y-3">
      <div>
        <h2 id="analytics-revenue" className="text-title-section text-foreground">Recorded revenue</h2>
        <p className="text-sm text-muted-foreground">
          From real cash events, not an opportunity's estimated or actual deal value - the two are tracked separately and never assumed equal.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Metric label="Total recorded revenue" state={money(kpis.revenue_total)} />
        <Metric label="Attributed to a known campaign" state={money(kpis.revenue_attributed)} />
        <Metric label="Unattributed (organic/manual/unknown)" state={money(kpis.revenue_unattributed)} />
      </div>
    </section>
  );
}

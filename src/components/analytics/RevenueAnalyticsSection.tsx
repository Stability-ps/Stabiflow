import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalyticsKpis } from "@/hooks/useAnalytics";
import { formatMoneyByCurrency } from "@/lib/analytics";

// revenue_total/attributed/unattributed all come straight from
// revenue_events (real recorded cash events) - never opportunities.
// actual_value, which is a separately-tracked deal value that this
// section deliberately does not relabel as revenue.
export function RevenueAnalyticsSection({ kpis, workspaceCurrency }: { kpis: AnalyticsKpis; workspaceCurrency: string }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Recorded revenue</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-md border p-3">
            <p className="text-lg font-semibold">{formatMoneyByCurrency(kpis.revenue_total, workspaceCurrency)}</p>
            <p className="text-xs text-muted-foreground">Total recorded revenue</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-lg font-semibold">{formatMoneyByCurrency(kpis.revenue_attributed, workspaceCurrency)}</p>
            <p className="text-xs text-muted-foreground">Attributed to a known campaign</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-lg font-semibold">{formatMoneyByCurrency(kpis.revenue_unattributed, workspaceCurrency)}</p>
            <p className="text-xs text-muted-foreground">Unattributed (organic/manual/unknown)</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Recorded from real cash events, not an opportunity's estimated/actual deal value - the two are tracked separately and are never assumed equal.
        </p>
      </CardContent>
    </Card>
  );
}

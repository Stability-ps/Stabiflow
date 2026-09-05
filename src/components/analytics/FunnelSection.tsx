import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalyticsKpis } from "@/hooks/useAnalytics";
import { buildFunnel, overallFunnelRate } from "@/lib/analytics";

export function FunnelSection({ kpis }: { kpis: AnalyticsKpis }) {
  const stages = buildFunnel([
    { label: "Conversations", count: kpis.conversations },
    { label: "Leads", count: kpis.leads },
    { label: "Qualified Leads", count: kpis.qualified_leads },
    { label: "Opportunities", count: kpis.opportunities },
    { label: "Customers", count: kpis.customers },
  ]);
  const overall = overallFunnelRate(stages);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Conversion funnel</CardTitle>
        {overall !== null && <span className="text-sm text-muted-foreground">Conversation → Customer: <span className="font-semibold text-foreground">{overall.toFixed(1)}%</span></span>}
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-stretch gap-2">
          {stages.map((stage, i) => (
            <div key={stage.label} className="flex items-center gap-2">
              <div className="min-w-[110px] rounded-lg border p-3 text-center">
                <p className="text-lg font-semibold">{stage.count}</p>
                <p className="text-xs text-muted-foreground">{stage.label}</p>
              </div>
              {i < stages.length - 1 && (
                <div className="flex flex-col items-center text-xs text-muted-foreground">
                  <span>→</span>
                  <span>{stages[i + 1].rateFromPrevious === null ? "—" : `${stages[i + 1].rateFromPrevious!.toFixed(0)}%`}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

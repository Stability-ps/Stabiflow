import { ChevronRight } from "lucide-react";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import type { AnalyticsKpis } from "@/hooks/useAnalytics";
import { buildFunnel, overallFunnelRate } from "@/lib/analytics";

export function FunnelSection({ kpis }: { kpis: AnalyticsKpis }) {
  const stages = buildFunnel([
    { label: "Conversations", count: kpis.conversations },
    { label: "Leads", count: kpis.leads },
    { label: "Qualified leads", count: kpis.qualified_leads },
    { label: "Opportunities", count: kpis.opportunities },
    { label: "Customers", count: kpis.customers },
  ]);
  const overall = overallFunnelRate(stages);

  return (
    <Panel aria-labelledby="analytics-funnel">
      <PanelHeader
        titleId="analytics-funnel"
        title="Conversion funnel"
        action={overall !== null ? <span className="text-xs text-muted-foreground">Conversation → customer <span className="font-semibold tabular-nums text-foreground">{overall.toFixed(1)}%</span></span> : null}
      />
      <PanelBody>
        {/* Phones: a vertical list (stage, count, step rate). sm+: one row of stages. */}
        <ol className="grid gap-2 lg:grid-cols-5">
          {stages.map((stage, i) => (
            <li key={stage.label} className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 lg:flex-col lg:items-start lg:justify-start lg:gap-0.5">
                <p className="order-2 text-lg font-semibold tabular-nums text-foreground lg:order-1">{stage.count.toLocaleString()}</p>
                <p className="order-1 min-w-0 truncate text-xs text-muted-foreground lg:order-2">{stage.label}</p>
                {i > 0 && (
                  <p className="order-3 hidden text-xs text-muted-foreground lg:block">
                    {stage.rateFromPrevious === null ? "—" : `${stage.rateFromPrevious.toFixed(0)}%`} of previous
                  </p>
                )}
              </div>
              {i > 0 && (
                <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground lg:hidden" aria-label={`${stage.rateFromPrevious === null ? "No" : `${stage.rateFromPrevious.toFixed(0)}%`} conversion from previous step`}>
                  {stage.rateFromPrevious === null ? "—" : `${stage.rateFromPrevious.toFixed(0)}%`}
                </span>
              )}
              {i === 0 && <span className="w-12 shrink-0 lg:hidden" aria-hidden="true" />}
              {i < stages.length - 1 && <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground xl:block" aria-hidden="true" />}
            </li>
          ))}
        </ol>
      </PanelBody>
    </Panel>
  );
}

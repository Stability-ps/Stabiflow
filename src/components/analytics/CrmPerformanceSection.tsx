import { XCircle } from "lucide-react";
import { Metric } from "@/components/ui/metric";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import type { CrmPerformance } from "@/hooks/useAnalytics";

export function CrmPerformanceSection({ data }: { data: CrmPerformance }) {
  // With no leads created in the range, a rate is undefined - show "—", not 0%.
  const hasLeads = data.active + data.converted + data.lost > 0;
  return (
    <section aria-labelledby="analytics-crm" className="space-y-3">
      <div>
        <h2 id="analytics-crm" className="text-title-section text-foreground">CRM performance</h2>
        <p className="text-sm text-muted-foreground">Qualification, follow-ups and outcomes for leads created in this period.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric label="Qualification rate" state={hasLeads ? { kind: "value", value: `${data.qualification_rate.toFixed(1)}%`, note: `${data.qualified} qualified` } : { kind: "no_data", note: "No leads this period" }} />
        <Metric label="Lead conversion" state={hasLeads ? { kind: "value", value: `${data.conversion_rate.toFixed(1)}%`, note: `${data.converted} converted` } : { kind: "no_data", note: "No leads this period" }} />
        <Metric label="Follow-ups due" state={data.follow_ups_due === 0 ? { kind: "zero", note: `${data.follow_ups_completed} completed` } : { kind: "value", value: String(data.follow_ups_due), note: `${data.follow_ups_completed} completed` }} />
        <Metric label="Overdue follow-ups" state={data.follow_ups_overdue === 0 ? { kind: "zero", note: "Nothing overdue" } : { kind: "value", value: String(data.follow_ups_overdue), note: <span className="font-medium text-warning">Needs attention</span> }} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel aria-labelledby="analytics-crm-outcomes">
          <PanelHeader titleId="analytics-crm-outcomes" title="Lead outcomes" />
          <PanelBody>
            <dl className="grid grid-cols-3 gap-3 text-center">
              {([["Active", data.active], ["Converted", data.converted], ["Lost", data.lost]] as const).map(([label, value]) => (
                <div key={label}><dd className="text-xl font-semibold tabular-nums text-foreground">{value}</dd><dt className="text-xs text-muted-foreground">{label}</dt></div>
              ))}
            </dl>
          </PanelBody>
        </Panel>
        <Panel aria-labelledby="analytics-crm-lost">
          <PanelHeader titleId="analytics-crm-lost" title="Why leads were lost" />
          <PanelBody>
            {data.lost_reasons.length === 0 ? (
              <p className="text-sm text-muted-foreground">No lost leads in this period.</p>
            ) : (
              <ul className="space-y-2">
                {data.lost_reasons.slice(0, 6).map((item) => (
                  <li key={item.reason} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2"><XCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="truncate text-foreground">{item.reason}</span></span>
                    <span className="font-medium tabular-nums text-foreground">{item.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </PanelBody>
        </Panel>
      </div>
    </section>
  );
}

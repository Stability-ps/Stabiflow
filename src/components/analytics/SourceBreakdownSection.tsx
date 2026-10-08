import { PieChart } from "lucide-react";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { EmptyState } from "@/components/EmptyState";
import type { SourceBreakdownRow } from "@/hooks/useAnalytics";
import { withSourcePercentages } from "@/lib/analytics";

export function SourceBreakdownSection({ rows }: { rows: SourceBreakdownRow[] }) {
  const withPct = withSourcePercentages(rows.map((r) => ({ label: r.source_label, count: r.lead_count })));
  return (
    <Panel aria-labelledby="analytics-sources">
      <PanelHeader titleId="analytics-sources" title="Where leads come from" />
      <PanelBody>
        {withPct.length === 0 ? (
          <EmptyState icon={PieChart} title="No leads in this range" description="Lead sources appear once leads are created in this range." className="py-6" />
        ) : (
          <ul className="space-y-3">
            {withPct.map((row) => (
              <li key={row.label}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-foreground">{row.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{row.count} · {row.percentage === null ? "—" : `${row.percentage.toFixed(0)}%`}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${row.percentage ?? 0}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

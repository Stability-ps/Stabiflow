import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/EmptyState";
import { PieChart } from "lucide-react";
import type { SourceBreakdownRow } from "@/hooks/useAnalytics";
import { withSourcePercentages } from "@/lib/analytics";

export function SourceBreakdownSection({ rows }: { rows: SourceBreakdownRow[] }) {
  const withPct = withSourcePercentages(rows.map((r) => ({ label: r.source_label, count: r.lead_count })));
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Where leads come from</CardTitle></CardHeader>
      <CardContent>
        {withPct.length === 0 ? (
          <EmptyState icon={PieChart} title="No leads yet" description="Lead sources appear once leads are created in this range." />
        ) : (
          <ul className="space-y-2">
            {withPct.map((row) => (
              <li key={row.label} className="flex items-center gap-3">
                <span className="w-40 shrink-0 text-sm">{row.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${row.percentage ?? 0}%` }} />
                </div>
                <span className="w-24 shrink-0 text-right text-sm text-muted-foreground">{row.count} ({row.percentage === null ? "—" : `${row.percentage.toFixed(0)}%`})</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

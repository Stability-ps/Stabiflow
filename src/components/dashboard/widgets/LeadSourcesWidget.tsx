import { PieChart } from "lucide-react";
import { useDashboardContext } from "@/lib/dashboard/DashboardContext";
import { useLeadSourceBreakdown } from "@/hooks/useAnalytics";
import { ChartCard } from "@/components/dashboard/ChartCard";
import { BarListChart, type BarListDatum } from "@/components/dashboard/BarListChart";
import { EmptyWidgetState } from "@/components/dashboard/EmptyWidgetState";
import { CATEGORICAL_CHART_COLORS, OTHER_CATEGORY_COLOR } from "@/lib/dashboard/chartTheme";

// Fixed categorical order, never cycled/regenerated - a 5th+ real source
// folds into "Other" rather than inventing a new hue (dataviz skill's
// series-count ladder: adjacent bars stay gate-safe up to 4).
function toBarData(rows: { source_label: string; lead_count: number }[]): BarListDatum[] {
  const sorted = [...rows].sort((a, b) => b.lead_count - a.lead_count);
  const top: BarListDatum[] = sorted.slice(0, 4).map((r, i) => ({ label: r.source_label, value: r.lead_count, color: CATEGORICAL_CHART_COLORS[i] }));
  const rest = sorted.slice(4);
  if (rest.length > 0) {
    top.push({ label: "Other", value: rest.reduce((sum, r) => sum + r.lead_count, 0), color: OTHER_CATEGORY_COLOR });
  }
  return top;
}

export function LeadSourcesWidget() {
  const { workspaceId, range } = useDashboardContext();
  const query = useLeadSourceBreakdown(workspaceId, range);
  const data = query.data ? toBarData(query.data) : [];

  return (
    <ChartCard
      title="Lead sources"
      description="Last 30 days"
      isLoading={query.isLoading}
      isError={query.isError}
      onRetry={() => query.refetch()}
      isEmpty={data.length === 0}
      emptyState={<EmptyWidgetState icon={PieChart} title="No leads yet" description="Lead sources appear once leads are created in this range." />}
    >
      <BarListChart data={data} title="Lead sources" valueFormatter={(v) => String(v)} />
    </ChartCard>
  );
}

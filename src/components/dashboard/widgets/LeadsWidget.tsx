import { Users } from "lucide-react";
import { useDashboardContext } from "@/lib/dashboard/DashboardContext";
import { useAnalyticsKpis } from "@/hooks/useAnalytics";
import { MetricCard, computeTrend } from "@/components/layout/MetricCard";

export function LeadsWidget() {
  const { workspaceId, range, previousRange } = useDashboardContext();
  const kpis = useAnalyticsKpis(workspaceId, range);
  const previous = useAnalyticsKpis(workspaceId, previousRange);

  return (
    <MetricCard
      icon={Users}
      label="Qualified leads (30d)"
      emptyMessage={kpis.isError ? "Data unavailable" : "No leads yet"}
      value={kpis.data ? String(kpis.data.qualified_leads) : undefined}
      trend={kpis.data && previous.data ? computeTrend(kpis.data.qualified_leads, previous.data.qualified_leads) : null}
    />
  );
}

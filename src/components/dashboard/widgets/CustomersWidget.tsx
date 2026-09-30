import { Contact } from "lucide-react";
import { useDashboardContext } from "@/lib/dashboard/DashboardContext";
import { useAnalyticsKpis } from "@/hooks/useAnalytics";
import { MetricCard, computeTrend } from "@/components/layout/MetricCard";

export function CustomersWidget() {
  const { workspaceId, range, previousRange } = useDashboardContext();
  const kpis = useAnalyticsKpis(workspaceId, range);
  const previous = useAnalyticsKpis(workspaceId, previousRange);

  return (
    <MetricCard
      icon={Contact}
      label="Customers (30d)"
      emptyMessage={kpis.isError ? "Data unavailable" : "No customers yet"}
      value={kpis.data ? String(kpis.data.customers) : undefined}
      trend={kpis.data && previous.data ? computeTrend(kpis.data.customers, previous.data.customers) : null}
    />
  );
}

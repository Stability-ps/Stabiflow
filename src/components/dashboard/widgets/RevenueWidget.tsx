import { TrendingUp } from "lucide-react";
import { useDashboardContext } from "@/lib/dashboard/DashboardContext";
import { useAnalyticsKpis } from "@/hooks/useAnalytics";
import { dashboardMoneyValue } from "@/lib/dashboardPresentation";
import { MetricCard } from "@/components/layout/MetricCard";

export function RevenueWidget() {
  const { workspaceId, range, currency, hasPermission } = useDashboardContext();
  const canSeeRevenue = hasPermission("revenue.view");
  const kpis = useAnalyticsKpis(canSeeRevenue ? workspaceId : null, range);

  if (!canSeeRevenue) return <MetricCard icon={TrendingUp} label="Revenue" emptyMessage="You don't have access" />;
  return (
    <MetricCard
      icon={TrendingUp}
      label="Revenue (30d)"
      emptyMessage={kpis.isError ? "Data unavailable" : "No data yet"}
      value={kpis.data ? dashboardMoneyValue(kpis.data.revenue_attributed, currency) : undefined}
    />
  );
}

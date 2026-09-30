import { Wallet } from "lucide-react";
import { useDashboardContext } from "@/lib/dashboard/DashboardContext";
import { useAnalyticsKpis } from "@/hooks/useAnalytics";
import { dashboardMoneyValue } from "@/lib/dashboardPresentation";
import { MetricCard } from "@/components/layout/MetricCard";

export function CampaignSpendWidget() {
  const { workspaceId, range, currency, metaConnected } = useDashboardContext();
  const kpis = useAnalyticsKpis(workspaceId, range);

  return (
    <MetricCard
      icon={Wallet}
      label="Campaign spend (30d)"
      emptyMessage={kpis.isError ? "Data unavailable" : metaConnected ? "No data yet" : "Meta not connected"}
      value={kpis.data ? dashboardMoneyValue(kpis.data.spend, currency) : undefined}
    />
  );
}

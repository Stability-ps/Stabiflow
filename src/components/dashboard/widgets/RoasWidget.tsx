import { BarChart3 } from "lucide-react";
import { useDashboardContext } from "@/lib/dashboard/DashboardContext";
import { useAnalyticsKpis } from "@/hooks/useAnalytics";
import { computeRoas, formatRoas, summarizeCurrency } from "@/lib/analytics";
import { MetricCard } from "@/components/layout/MetricCard";

export function RoasWidget() {
  const { workspaceId, range, hasPermission } = useDashboardContext();
  const canSeeRevenue = hasPermission("revenue.view");
  const kpis = useAnalyticsKpis(canSeeRevenue ? workspaceId : null, range);

  if (!canSeeRevenue) return <MetricCard icon={BarChart3} label="ROAS" emptyMessage="You don't have access" />;

  const spendTotal = kpis.data ? summarizeCurrency(kpis.data.spend) : null;
  const roas = kpis.data && spendTotal?.kind === "single" ? computeRoas(spendTotal.amountMinor, spendTotal.currency, kpis.data.revenue_attributed) : null;
  const value = roas?.status === "ok" || roas?.status === "mixed_currency" ? formatRoas(roas) : undefined;

  return (
    <MetricCard
      icon={BarChart3}
      label="ROAS (30d)"
      emptyMessage={kpis.isError ? "Data unavailable" : "Not enough data yet"}
      value={value}
    />
  );
}

import { useNavigate } from "react-router-dom";
import { BarChart3 } from "lucide-react";
import { useDashboardContext } from "@/lib/dashboard/DashboardContext";
import { useCampaignPerformance } from "@/hooks/useAnalytics";
import { DEFAULT_ATTRIBUTION_MODEL, formatMoneyByCurrency } from "@/lib/analytics";
import { ChartCard } from "@/components/dashboard/ChartCard";
import { BarListChart, type BarListDatum } from "@/components/dashboard/BarListChart";
import { EmptyWidgetState } from "@/components/dashboard/EmptyWidgetState";
import { Button } from "@/components/ui/button";
import { MAGNITUDE_CHART_COLOR } from "@/lib/dashboard/chartTheme";

export function CampaignPerformanceWidget() {
  const navigate = useNavigate();
  const { workspaceId, range, currency, metaConnected } = useDashboardContext();
  const query = useCampaignPerformance(workspaceId, range, DEFAULT_ATTRIBUTION_MODEL);
  const rows = [...(query.data ?? [])].sort((a, b) => b.spend_minor - a.spend_minor).slice(0, 5);
  const data: BarListDatum[] = rows.map((r) => ({ label: r.name, value: r.spend_minor }));

  return (
    <ChartCard
      title="Campaign performance"
      description="Spend, last 30 days"
      isLoading={query.isLoading}
      isError={query.isError}
      onRetry={() => query.refetch()}
      isEmpty={data.length === 0}
      emptyState={(
        <EmptyWidgetState
          icon={BarChart3}
          title="No campaign data yet"
          description={metaConnected ? "Launch your first campaign to see performance here." : "Connect your Meta account to launch and track campaigns."}
          action={<Button size="sm" onClick={() => navigate(metaConnected ? "/app/campaigns/new" : "/app/integrations")}>{metaConnected ? "Create a campaign" : "Go to Integrations"}</Button>}
        />
      )}
    >
      <BarListChart data={data} color={MAGNITUDE_CHART_COLOR} title="Campaign performance" valueFormatter={(v) => formatMoneyByCurrency([{ currency, amount_minor: v }], currency)} />
    </ChartCard>
  );
}

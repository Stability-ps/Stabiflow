import { MessageSquare } from "lucide-react";
import { useDashboardContext } from "@/lib/dashboard/DashboardContext";
import { useWhatsAppAnalytics } from "@/hooks/useAnalytics";
import { ChartCard } from "@/components/dashboard/ChartCard";
import { BarListChart, type BarListDatum } from "@/components/dashboard/BarListChart";
import { EmptyWidgetState } from "@/components/dashboard/EmptyWidgetState";
import { FUNNEL_STAGE_COLORS } from "@/lib/dashboard/chartTheme";

export function WhatsAppFunnelWidget() {
  const { workspaceId, range, whatsappConnected } = useDashboardContext();
  const query = useWhatsAppAnalytics(whatsappConnected ? workspaceId : null, range);

  const data: BarListDatum[] = query.data ? [
    { label: "Conversations", value: query.data.conversations_started, color: FUNNEL_STAGE_COLORS[0] },
    { label: "Became leads", value: query.data.became_leads, color: FUNNEL_STAGE_COLORS[1] },
    { label: "Qualified", value: query.data.became_qualified, color: FUNNEL_STAGE_COLORS[2] },
    { label: "Customers", value: query.data.became_customers, color: FUNNEL_STAGE_COLORS[3] },
  ] : [];

  return (
    <ChartCard
      title="WhatsApp activity"
      description="Last 30 days"
      isLoading={query.isLoading}
      isError={query.isError}
      onRetry={() => query.refetch()}
      isEmpty={!whatsappConnected || data.every((d) => d.value === 0)}
      emptyState={(
        <EmptyWidgetState
          icon={MessageSquare}
          title={whatsappConnected ? "No conversations yet" : "WhatsApp not connected"}
          description={whatsappConnected ? "New conversations will appear here." : "Connect WhatsApp in Settings to see this widget."}
        />
      )}
    >
      <BarListChart data={data} title="WhatsApp activity" valueFormatter={(v) => String(v)} />
    </ChartCard>
  );
}

import { MessageSquare } from "lucide-react";
import { useDashboardContext } from "@/lib/dashboard/DashboardContext";
import { useAnalyticsKpis } from "@/hooks/useAnalytics";
import { dashboardConversationValue } from "@/lib/dashboardPresentation";
import { MetricCard } from "@/components/layout/MetricCard";

export function ConversationsWidget() {
  const { workspaceId, range, whatsappConnected } = useDashboardContext();
  const kpis = useAnalyticsKpis(workspaceId, range);

  return (
    <MetricCard
      icon={MessageSquare}
      label="Conversations (30d)"
      emptyMessage={kpis.isError ? "Data unavailable" : "WhatsApp not connected"}
      value={kpis.data ? dashboardConversationValue(kpis.data.conversations, whatsappConnected) : undefined}
    />
  );
}

import { Workflow } from "lucide-react";
import { useDashboardContext } from "@/lib/dashboard/DashboardContext";
import { useAutomations } from "@/hooks/useAutomations";
import { MetricCard } from "@/components/layout/MetricCard";

export function AutomationsStatusWidget() {
  const { workspaceId } = useDashboardContext();
  const query = useAutomations(workspaceId);
  const enabled = (query.data ?? []).filter((a) => a.status === "enabled").length;
  const total = query.data?.length ?? 0;

  return (
    <MetricCard
      icon={Workflow}
      label="Automations"
      emptyMessage={query.isError ? "Data unavailable" : "No automations yet"}
      value={query.data && total > 0 ? `${enabled} of ${total} enabled` : undefined}
    />
  );
}

import { useDashboardContext } from "@/lib/dashboard/DashboardContext";
import { NeedsAttentionPanel } from "@/components/dashboard/NeedsAttentionPanel";

export function NeedsAttentionWidget() {
  const { workspaceId } = useDashboardContext();
  return <NeedsAttentionPanel workspaceId={workspaceId} />;
}

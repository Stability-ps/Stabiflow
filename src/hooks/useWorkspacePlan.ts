import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { fetchBillingState, summarizePlan, type PlanSummary } from "@/lib/billing";

/**
 * The current workspace's plan for compact UI (sidebar). Shares the
 * ["billing-state", workspaceId] cache with the Billing page, so the shell
 * adds no extra billing request when Billing is open and refreshes when
 * Billing invalidates it after a checkout or cancellation.
 */
export function useWorkspacePlan(): PlanSummary {
  const { currentWorkspaceId } = useAuth();
  const query = useQuery({
    queryKey: ["billing-state", currentWorkspaceId],
    queryFn: () => fetchBillingState(currentWorkspaceId as string),
    enabled: !!currentWorkspaceId,
    staleTime: 5 * 60_000,
  });
  return summarizePlan(query.data, { isLoading: query.isLoading, isError: query.isError });
}

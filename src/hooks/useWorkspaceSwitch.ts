import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";

/** Workspace switching shared by the desktop dropdown and the mobile sheet. */
export function useWorkspaceSwitch() {
  const { memberships, currentWorkspaceId, currentMembership, setCurrentWorkspaceId } = useAuth();
  const queryClient = useQueryClient();
  const switchTo = async (workspaceId: string) => {
    if (workspaceId === currentWorkspaceId) return;

    // Cache isolation on switch: every workspace-scoped query is keyed
    // with the workspace id (e.g. ["workspace-activity", workspaceId]),
    // so React Query already treats workspace B's data as a completely
    // separate cache entry from workspace A's - switching never shows
    // stale data from the old workspace while the new one loads, it shows
    // a normal loading state for a key that has no cached data yet.
    // Cancelling in-flight requests for the OLD workspace here is a
    // belt-and-suspenders step on top of that: it stops a slow request
    // for A from doing pointless work (and, if a query were ever
    // mis-keyed without the workspace id, from resolving after the
    // switch and overwriting a shared cache entry).
    await queryClient.cancelQueries();
    setCurrentWorkspaceId(workspaceId);
  };

  return { memberships, currentWorkspaceId, currentMembership, switchTo };
}

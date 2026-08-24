import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function WorkspaceSwitcher() {
  const { memberships, currentWorkspaceId, currentMembership, setCurrentWorkspaceId } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

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

  if (memberships.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-[220px] justify-between gap-2">
          <span className="truncate">{currentMembership?.workspace.name ?? "Select workspace"}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.map((m) => (
          <DropdownMenuItem key={m.workspaceId} onClick={() => switchTo(m.workspaceId)} className="flex items-center justify-between gap-2">
            <span className="min-w-0">
              <span className="block truncate">{m.workspace.name}</span>
              <span className="block text-xs text-muted-foreground">{m.role}</span>
            </span>
            {m.workspaceId === currentWorkspaceId ? <Check className="h-4 w-4 shrink-0" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/create-workspace")}>
          <Plus className="mr-2 h-4 w-4" />
          Create workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

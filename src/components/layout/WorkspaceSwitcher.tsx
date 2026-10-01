import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useWorkspaceSwitch } from "@/hooks/useWorkspaceSwitch";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function WorkspaceSwitcher() {
  const { memberships, currentWorkspaceId, currentMembership, switchTo } = useWorkspaceSwitch();
  const navigate = useNavigate();

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

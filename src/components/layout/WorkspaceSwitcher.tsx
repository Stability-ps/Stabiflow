import { Check, ChevronsUpDown, CreditCard, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useWorkspaceSwitch } from "@/hooks/useWorkspaceSwitch";
import { useWorkspacePlan } from "@/hooks/useWorkspacePlan";
import { planSummaryLabel } from "@/lib/billing";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Desktop workspace switcher at the top of the sidebar: brand mark, workspace
 * name and plan. Collapsed to the icon rail it is the brand mark alone and
 * opens the same menu. Phones use MobileWorkspaceSheet instead.
 */
export function WorkspaceSwitcher() {
  const { memberships, currentWorkspaceId, currentMembership, switchTo } = useWorkspaceSwitch();
  const plan = useWorkspacePlan();
  const navigate = useNavigate();
  const workspaceName = currentMembership?.workspace.name ?? "Select workspace";
  const planLabel = planSummaryLabel(plan);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={`${workspaceName} · ${planLabel}`}
              aria-label={`Workspace: ${workspaceName}. ${planLabel}. Switch workspace`}
              data-testid="workspace-switcher"
              className="h-12 gap-2.5 px-2 hover:bg-accent data-[state=open]:bg-accent group-data-[collapsible=icon]:!p-1"
            >
              <BrandLogo variant="icon" className="h-7 w-7 shrink-0 rounded-md" />
              <span className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate text-label font-semibold text-foreground" title={workspaceName}>{workspaceName}</span>
                <span
                  className={cn("truncate text-xs", plan.status === "unavailable" ? "text-subtle-foreground" : "text-muted-foreground")}
                  data-plan-status={plan.status}
                >
                  {planLabel}
                </span>
              </span>
              <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 text-subtle-foreground" aria-hidden="true" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" className="w-64">
            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Workspaces</DropdownMenuLabel>
            {memberships.map((m) => (
              <DropdownMenuItem key={m.workspaceId} onClick={() => void switchTo(m.workspaceId)} className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate">{m.workspace.name}</span>
                  <span className="block text-xs capitalize text-muted-foreground">{m.role}</span>
                </span>
                {m.workspaceId === currentWorkspaceId ? <Check className="h-4 w-4 shrink-0 text-primary" aria-label="Current workspace" /> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/app/billing")}>
              <CreditCard className="mr-2 h-4 w-4" />
              Billing &amp; plan
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/create-workspace")}>
              <Plus className="mr-2 h-4 w-4" />
              Create workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

import { useState } from "react";
import { toast } from "sonner";
import { MoreVertical, Plus, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { Sheet } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { roleHasPermission } from "@/lib/permissions";
import { useAutomations, type AutomationRow } from "@/hooks/useAutomations";
import { setAutomationStatus, deleteAutomation, EVENT_TYPE_LABELS } from "@/lib/automations";
import { AutomationBuilderDialog } from "@/pages/dashboard/automations/AutomationBuilderDialog";
import { AutomationRunsSheet } from "@/pages/dashboard/automations/AutomationRunsSheet";

const STATUS_LABEL: Record<AutomationRow["status"], string> = { draft: "Draft", enabled: "Enabled", disabled: "Disabled" };

export default function Automations() {
  const { currentWorkspaceId, currentMembership } = useAuth();
  const role = currentMembership?.role;
  const canView = roleHasPermission(role, "automation.view");
  const canCreate = roleHasPermission(role, "automation.create");
  const canEdit = roleHasPermission(role, "automation.edit");
  const canEnable = roleHasPermission(role, "automation.enable");
  const canDelete = roleHasPermission(role, "automation.delete");
  const canViewRuns = roleHasPermission(role, "automation.view_runs");

  const { data: automations, isLoading, refetch } = useAutomations(canView ? currentWorkspaceId : null);

  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<AutomationRow | null>(null);
  const [runsAutomation, setRunsAutomation] = useState<AutomationRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!currentWorkspaceId || isLoading) {
    return <div className="h-[70vh] animate-pulse rounded-lg bg-muted" />;
  }

  if (!canView) {
    return <EmptyState icon={Workflow} title="Automations" description="You don't have permission to view this workspace's automations. Ask a workspace owner or admin." />;
  }

  async function toggleStatus(automation: AutomationRow) {
    const nextStatus = automation.status === "enabled" ? "disabled" : "enabled";
    setBusyId(automation.id);
    try {
      await setAutomationStatus(currentWorkspaceId as string, automation.id, nextStatus);
      toast.success(nextStatus === "enabled" ? "Automation enabled" : "Automation disabled");
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to update this automation");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(automation: AutomationRow) {
    if (!confirm(`Delete "${automation.name}"? This cannot be undone.`)) return;
    setBusyId(automation.id);
    try {
      await deleteAutomation(currentWorkspaceId as string, automation.id);
      toast.success("Automation deleted");
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to delete this automation");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Automations</h1>
          <p className="text-sm text-muted-foreground">WHEN a trigger event happens, IF conditions match, THEN run one or more actions - through the same rules and permissions as doing it yourself.</p>
        </div>
        {canCreate && (
          <Button size="sm" onClick={() => { setEditingAutomation(null); setBuilderOpen(true); }}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> New automation
          </Button>
        )}
      </div>

      {(automations || []).length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No automations yet"
          description="Automations react to real events in StabiFlow - a new lead, a stage change, a published post - and run deterministic actions through the same dispatchers the rest of the app uses."
          action={canCreate ? <Button size="sm" onClick={() => { setEditingAutomation(null); setBuilderOpen(true); }}><Plus className="mr-1.5 h-3.5 w-3.5" /> New automation</Button> : undefined}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Trigger</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {(automations || []).map((automation) => (
                <tr key={automation.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="px-4 py-2.5 font-medium">{automation.name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{EVENT_TYPE_LABELS[automation.trigger_event_type]}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant={automation.status === "enabled" ? "default" : automation.status === "disabled" ? "secondary" : "outline"}>{STATUS_LABEL[automation.status]}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" disabled={busyId === automation.id}><MoreVertical className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canViewRuns && <DropdownMenuItem onClick={() => setRunsAutomation(automation)}>View run history</DropdownMenuItem>}
                        {canEdit && <DropdownMenuItem onClick={() => { setEditingAutomation(automation); setBuilderOpen(true); }}>Edit</DropdownMenuItem>}
                        {canEnable && (
                          <DropdownMenuItem onClick={() => toggleStatus(automation)}>
                            {automation.status === "enabled" ? "Disable" : "Enable"}
                          </DropdownMenuItem>
                        )}
                        {canDelete && <DropdownMenuItem onClick={() => handleDelete(automation)} className="text-destructive focus:text-destructive">Delete</DropdownMenuItem>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AutomationBuilderDialog
        workspaceId={currentWorkspaceId}
        automation={editingAutomation}
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        onSaved={() => { setBuilderOpen(false); refetch(); }}
      />

      <Sheet open={!!runsAutomation} onOpenChange={(v) => !v && setRunsAutomation(null)}>
        {runsAutomation && <AutomationRunsSheet workspaceId={currentWorkspaceId} automation={runsAutomation} />}
      </Sheet>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { MoreVertical, Plus, Workflow } from "lucide-react";
import { WhatsAppContextBanner } from "@/components/whatsapp/WhatsAppContextBanner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { Sheet } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { roleHasPermission } from "@/lib/permissions";
import { useAutomations, type AutomationRow } from "@/hooks/useAutomations";
import { setAutomationStatus, deleteAutomation, EVENT_TYPE_LABELS } from "@/lib/automations";
import { AutomationBuilderDialog, type AutomationTemplate } from "@/pages/dashboard/automations/AutomationBuilderDialog";
import { AutomationRunsSheet } from "@/pages/dashboard/automations/AutomationRunsSheet";

const STATUS_LABEL: Record<AutomationRow["status"], string> = { draft: "Draft", enabled: "Enabled", disabled: "Disabled" };

// Starter examples for the empty state - every trigger/action pair here is
// a real type in supabase/functions/_shared/automations/taxonomy.ts, never
// invented. "Opportunity won -> Create customer" was deliberately left out:
// there is no create_customer action type (customer creation happens
// automatically elsewhere, not via an automation).
const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  { name: "New conversation creates a lead", triggerEventType: "conversation.started", actionType: "create_lead" },
  { name: "Qualified leads notify the team", triggerEventType: "lead.qualified", actionType: "create_notification" },
  { name: "Published content notifies the team", triggerEventType: "content.published", actionType: "create_notification" },
];

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

  // Entered from WhatsApp > Automations: show the "came from WhatsApp"
  // context and narrow the list to conversation/message triggers. Purely a
  // view filter - nothing is created, edited, or hidden from other routes.
  const [searchParams] = useSearchParams();
  const fromWhatsApp = searchParams.get("trigger") === "conversation";
  const visibleAutomations = useMemo(() => {
    const all = automations || [];
    if (!fromWhatsApp) return all;
    return all.filter((a) => a.trigger_event_type.startsWith("conversation.") || a.trigger_event_type.startsWith("message."));
  }, [automations, fromWhatsApp]);

  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<AutomationRow | null>(null);
  const [pendingTemplate, setPendingTemplate] = useState<AutomationTemplate | null>(null);
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
      {fromWhatsApp && (
        <div className="mb-4">
          <WhatsAppContextBanner label="Showing automations triggered by WhatsApp conversations." />
        </div>
      )}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Automations</h1>
          <p className="text-sm text-muted-foreground">WHEN a trigger event happens, IF conditions match, THEN run one or more actions - through the same rules and permissions as doing it yourself.</p>
        </div>
        {canCreate && (
          <Button size="sm" onClick={() => { setEditingAutomation(null); setPendingTemplate(null); setBuilderOpen(true); }}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> New automation
          </Button>
        )}
      </div>

      {fromWhatsApp && (automations || []).length > 0 && visibleAutomations.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No WhatsApp automations yet"
          description="None of this workspace's automations are triggered by a WhatsApp conversation or message. Create one, or clear the filter to see all automations."
        />
      ) : (automations || []).length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No automations yet"
          description="Automations save your team time by reacting to things that happen in StabiFlow - a new conversation, a lead getting qualified, a post going live - and automatically taking the next step, using the exact same rules and permissions a staff member would."
          action={
            canCreate ? (
              <div className="flex flex-col items-center gap-3">
                <Button size="sm" onClick={() => { setEditingAutomation(null); setPendingTemplate(null); setBuilderOpen(true); }}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> New automation
                </Button>
                <div>
                  <p className="mb-1.5 text-xs text-muted-foreground">Or start from an example:</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {AUTOMATION_TEMPLATES.map((tpl) => (
                      <Button
                        key={tpl.name}
                        size="sm"
                        variant="outline"
                        onClick={() => { setEditingAutomation(null); setPendingTemplate(tpl); setBuilderOpen(true); }}
                      >
                        {tpl.name}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            ) : undefined
          }
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
              {visibleAutomations.map((automation) => (
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
        template={pendingTemplate}
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

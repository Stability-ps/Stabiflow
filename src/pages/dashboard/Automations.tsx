import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Bell, MessageCircle, MoreVertical, Plus, UserPlus, Workflow } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { WhatsAppContextBanner } from "@/components/whatsapp/WhatsAppContextBanner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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

// Outcome-first templates for the landing page - every trigger/action pair
// is a real type in supabase/functions/_shared/automations/taxonomy.ts
// (mirrored in src/lib/automations.ts EVENT_TYPES/ACTION_TYPES), never
// invented. No unpaid-invoice template: invoicing doesn't exist yet (see
// src/lib/navigation.ts) and this page must never advertise a workflow
// that isn't real.
const OUTCOME_TEMPLATES: { title: string; description: string; icon: LucideIcon; template: AutomationTemplate }[] = [
  {
    title: "Follow up with new leads",
    description: "Automatically send a WhatsApp message when a new lead arrives.",
    icon: UserPlus,
    template: { name: "Follow up with new leads", triggerEventType: "lead.created", actionType: "send_whatsapp_template" },
  },
  {
    title: "Welcome new customers",
    description: "Send a personalised WhatsApp welcome message.",
    icon: MessageCircle,
    template: { name: "Welcome new customers", triggerEventType: "customer.created", actionType: "send_whatsapp_template" },
  },
  {
    title: "Notify my team",
    description: "Notify the team as soon as a lead is marked qualified.",
    icon: Bell,
    template: { name: "Notify my team when a lead qualifies", triggerEventType: "lead.qualified", actionType: "create_notification" },
  },
  {
    title: "Turn conversations into leads",
    description: "Automatically create a lead when a new WhatsApp conversation starts.",
    icon: MessageCircle,
    template: { name: "New conversation creates a lead", triggerEventType: "conversation.started", actionType: "create_lead" },
  },
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

  function openBuilder(template: AutomationTemplate | null) {
    setEditingAutomation(null);
    setPendingTemplate(template);
    setBuilderOpen(true);
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
    <div className="flex flex-col gap-6">
      {fromWhatsApp && <WhatsAppContextBanner label="Showing automations triggered by WhatsApp conversations." />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Automations</h1>
          <p className="text-sm text-muted-foreground">Let StabiFlow handle repetitive work for you.</p>
        </div>
        {canCreate && (
          <Button size="sm" onClick={() => openBuilder(null)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Create automation
          </Button>
        )}
      </div>

      {canCreate && !fromWhatsApp && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {OUTCOME_TEMPLATES.map(({ title, description, icon: Icon, template }) => (
            <Card key={title} className="flex flex-col">
              <CardHeader className="pb-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ai/10 text-ai">
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <CardTitle className="pt-2 text-base">{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
              <CardFooter className="mt-auto pt-2">
                <Button size="sm" variant="outline" className="w-full" onClick={() => openBuilder(template)}>Set up</Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      <div>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Your automations</h2>
          <p className="hidden text-xs text-muted-foreground sm:block">Runs WHEN a trigger happens, IF conditions match, THEN actions run.</p>
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
            description="Set up one of the templates above, or build your own from scratch - using the exact same rules and permissions a staff member would."
            action={canCreate ? <Button size="sm" onClick={() => openBuilder(null)}><Plus className="mr-1.5 h-3.5 w-3.5" /> Create automation</Button> : undefined}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[560px] text-sm">
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
                          {canEdit && <DropdownMenuItem onClick={() => { setEditingAutomation(automation); setPendingTemplate(null); setBuilderOpen(true); }}>Edit</DropdownMenuItem>}
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
      </div>

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

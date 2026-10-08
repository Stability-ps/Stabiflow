import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, MoreVertical, Plus, Workflow } from "lucide-react";
import { WhatsAppContextBanner } from "@/components/whatsapp/WhatsAppContextBanner";
import { Button } from "@/components/ui/button";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/EmptyState";
import { Sheet } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { roleHasPermission } from "@/lib/permissions";
import { useAutomations, type AutomationRow } from "@/hooks/useAutomations";
import { setAutomationStatus, deleteAutomation, EVENT_TYPE_LABELS } from "@/lib/automations";
import { fetchEntitlements } from "@/lib/billing";
import { AutomationBuilderDialog, type AutomationTemplate } from "@/pages/dashboard/automations/AutomationBuilderDialog";
import { AutomationRunsSheet } from "@/pages/dashboard/automations/AutomationRunsSheet";
import { GuideHelpLink } from "@/components/guide/GuideHelpLink";

const STATUS_LABEL: Record<AutomationRow["status"], string> = { draft: "Draft", enabled: "Enabled", disabled: "Disabled" };
const STATUS_TONE: Record<AutomationRow["status"], StatusTone> = { draft: "neutral", enabled: "success", disabled: "neutral" };

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
  const entitlementQuery = useQuery({
    queryKey: ["entitlements", currentWorkspaceId],
    queryFn: () => fetchEntitlements(currentWorkspaceId as string),
    enabled: !!currentWorkspaceId,
  });
  const automationEntitlement = entitlementQuery.data?.find((e) => e.entitlement_key === "automation_runs");
  const hasAutomationSubscription = automationEntitlement?.enabled === true;

  const { data: automations, isLoading, isError, refetch } = useAutomations(canView ? currentWorkspaceId : null);

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
  const [deleteTarget, setDeleteTarget] = useState<AutomationRow | null>(null);

  const pageHeader = (action?: ReactNode) => (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0 max-w-2xl">
        <h1 className="text-title-page text-foreground">Automations</h1>
        <p className="mt-1 text-sm text-muted-foreground">When something happens and your conditions match, StabiFlow takes the next step - through the same rules and permissions as doing it yourself.</p>
        <GuideHelpLink chapter="automations" className="mt-1" />
      </div>
      {action}
    </header>
  );
  const shell = (body: ReactNode) => <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">{pageHeader()}{body}</div>;

  if (!currentWorkspaceId || isLoading || entitlementQuery.isLoading) {
    return shell(<div className="h-64 animate-pulse rounded-xl bg-muted" role="status" aria-label="Loading automations" />);
  }

  if (!canView) {
    return shell(<EmptyState icon={Workflow} title="No access to automations" description="You don't have permission to view this workspace's automations. Ask a workspace owner or admin." className="rounded-xl border border-border bg-card" />);
  }

  // An unreadable entitlement is NOT "not on the plan" - telling a paying
  // customer to upgrade because a request failed would be wrong.
  if (entitlementQuery.isError) {
    return shell(
      <EmptyState
        icon={AlertTriangle}
        title="Couldn't check your plan"
        description="We couldn't confirm whether Automations are included in your plan. Nothing has changed - try again."
        action={<Button variant="outline" onClick={() => void entitlementQuery.refetch()}>Try again</Button>}
        className="rounded-xl border border-border bg-card"
      />,
    );
  }

  if (!hasAutomationSubscription) {
    return shell(
      <EmptyState
        icon={Workflow}
        title="Unlock Automations"
        description="Automations are included with the Growth plan, with 2,000 runs per month. Upgrade to Growth to start automating."
        action={<Button size="sm" asChild><Link to="/app/billing">View plans</Link></Button>}
        className="rounded-xl border border-border bg-card"
      />,
    );
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
    setDeleteTarget(null);
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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      {fromWhatsApp && <WhatsAppContextBanner label="Showing automations triggered by WhatsApp conversations." />}
      {pageHeader(canCreate && !isError ? (
        <Button onClick={() => { setEditingAutomation(null); setPendingTemplate(null); setBuilderOpen(true); }}>
          <Plus aria-hidden="true" /> New automation
        </Button>
      ) : undefined)}

      {isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load automations"
          description="Something went wrong fetching this workspace's automations. They are still running as configured - try again."
          action={<Button variant="outline" onClick={() => void refetch()}>Try again</Button>}
          className="rounded-xl border border-border bg-card"
        />
      ) : fromWhatsApp && (automations || []).length > 0 && visibleAutomations.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No WhatsApp automations yet"
          description="None of this workspace's automations are triggered by a WhatsApp conversation or message. Create one, or clear the filter to see all automations."
          className="rounded-xl border border-border bg-card"
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
                  <Plus aria-hidden="true" /> New automation
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
          className="rounded-xl border border-border bg-card"
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-overline uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Name</th>
                <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">Trigger</th>
                <th scope="col" className="px-4 py-2 font-medium">Status</th>
                <th scope="col" className="w-12 px-2 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visibleAutomations.map((automation) => (
                <tr key={automation.id} className="border-b border-border transition-colors duration-fast last:border-b-0 hover:bg-accent/40">
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{automation.name}</p>
                    {/* Phones: the trigger column is hidden, so say it here. */}
                    <p className="mt-0.5 text-xs text-muted-foreground sm:hidden">{EVENT_TYPE_LABELS[automation.trigger_event_type]}</p>
                  </td>
                  <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">{EVENT_TYPE_LABELS[automation.trigger_event_type]}</td>
                  <td className="px-4 py-3">
                    <StatusPill tone={STATUS_TONE[automation.status] ?? "neutral"}>{STATUS_LABEL[automation.status]}</StatusPill>
                  </td>
                  <td className="px-2 py-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" disabled={busyId === automation.id} aria-label={`Actions for ${automation.name}`}><MoreVertical className="h-4 w-4" aria-hidden="true" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canViewRuns && <DropdownMenuItem onClick={() => setRunsAutomation(automation)}>View run history</DropdownMenuItem>}
                        {canEdit && <DropdownMenuItem onClick={() => { setEditingAutomation(automation); setBuilderOpen(true); }}>Edit</DropdownMenuItem>}
                        {canEnable && (
                          <DropdownMenuItem onClick={() => toggleStatus(automation)}>
                            {automation.status === "enabled" ? "Disable" : "Enable"}
                          </DropdownMenuItem>
                        )}
                        {canDelete && <DropdownMenuItem onClick={() => setDeleteTarget(automation)} className="text-destructive focus:text-destructive">Delete</DropdownMenuItem>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>This automation stops running and its configuration is removed. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && void handleDelete(deleteTarget)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

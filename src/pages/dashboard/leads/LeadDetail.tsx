import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, CheckCircle2, Clock, Mail, MessageCircle, Phone, Trophy, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { useLead, useLeadAttachments, usePipelineStages } from "@/hooks/useLeads";
import { useOpportunitiesForLead, useCrmNotes, useCustomerForOpportunity, useCustomerForLead } from "@/hooks/useOpportunities";
import { intakeRows, formatBytes } from "@/lib/intakeDisplay";
import { QUALIFICATION_STATUSES, qualificationStatusLabel, validateQualificationChange, type QualificationStatus } from "@/lib/qualification";
import { opportunityStatusLabel } from "@/lib/opportunityLifecycle";
import { openOpportunityActionLabel, pluralizeLabel } from "@/lib/terminology";
import {
  addCrmNote, assignLead, completeLeadFollowUp, createOpportunity, markLeadLost, markOpportunityLost, markOpportunityWon,
  moveLeadStage, reopenLead, reopenOpportunity, restoreLead, setLeadFollowUp, setLeadQualification, signLeadAttachment, archiveLead,
} from "@/lib/leads";
import { Paperclip } from "lucide-react";
import { AttributionSourceSummary } from "@/components/attribution/AttributionSourceSummary";
import { RevenueSection } from "@/components/attribution/RevenueSection";
import { CustomerDetail } from "@/pages/dashboard/leads/CustomerDetail";
import { StatusPill } from "@/components/ui/status-pill";
import { followUpState, sourceLabel } from "@/lib/leadsWorkspace";

// Phase 2: documents the customer sent on WhatsApp, linked to the lead at
// conversion. Metadata comes from the RLS-scoped lead_attachments rows;
// the file itself opens through a short-lived server-minted signed URL
// (the storage path never reaches the client).
function LeadDocuments({ workspaceId, leadId, canView }: { workspaceId: string; leadId: string; canView: boolean }) {
  const { data: attachments } = useLeadAttachments(canView ? leadId : null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  if (!canView || !attachments || attachments.length === 0) return null;

  const open = async (id: string) => {
    setOpeningId(id);
    try {
      const { url } = await signLeadAttachment(workspaceId, id);
      const w = window.open(url, "_blank", "noopener,noreferrer");
      if (!w) toast.error("Allow pop-ups to open this document.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(message || "This document couldn't be opened. It may have been removed.");
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <section className="space-y-2">
      <h3 className="text-overline uppercase text-muted-foreground">Documents ({attachments.length})</h3>
      <div className="space-y-1.5">
        {attachments.map((a) => {
          const size = formatBytes(a.media_size_bytes);
          const received = a.received_at ? new Date(a.received_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : null;
          return (
            <div key={a.id} className="flex items-center gap-2 rounded-md border p-2 text-xs">
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{a.media_filename || "Attachment"}</p>
                <p className="text-muted-foreground">
                  {[a.media_mime_type, size, received && `received ${received}`].filter(Boolean).join(" · ") || "From WhatsApp conversation"}
                </p>
              </div>
              <Button size="sm" variant="ghost" className="h-7" disabled={openingId === a.id} onClick={() => open(a.id)}>Open</Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WonOpportunityRevenue({ workspaceId, opportunityId, leadId, canRecordRevenue, onViewCustomer }: { workspaceId: string; opportunityId: string; leadId: string; canRecordRevenue: boolean; onViewCustomer: (customerId: string) => void }) {
  const { data: customer } = useCustomerForOpportunity(opportunityId);
  return (
    <div className="space-y-1">
      {customer && (
        <Button size="sm" variant="ghost" className="h-6 px-1 text-[11px]" onClick={() => onViewCustomer(customer.id)}>View customer: {customer.name}</Button>
      )}
      <RevenueSection workspaceId={workspaceId} opportunityId={opportunityId} customerId={customer?.id ?? null} leadId={leadId} canRecord={canRecordRevenue} />
    </div>
  );
}

export function LeadDetail({ workspaceId, leadId, canEdit, canAssign, canViewAttachments, canCreateOpportunity, canCloseOpportunity, canRecordRevenue, canArchive = false, opportunityLabel, autoOpenOpportunityForm }: {
  workspaceId: string;
  leadId: string;
  canEdit: boolean;
  canAssign: boolean;
  canViewAttachments: boolean;
  canCreateOpportunity: boolean;
  canCloseOpportunity: boolean;
  canRecordRevenue: boolean;
  /** lead.delete - archive/restore (owner, admin, manager). */
  canArchive?: boolean;
  opportunityLabel: string;
  autoOpenOpportunityForm?: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: lead } = useLead(leadId);
  const { data: members } = useWorkspaceMembers(workspaceId);
  const { data: opportunities } = useOpportunitiesForLead(leadId);
  const { data: notes } = useCrmNotes("lead", leadId);
  const { data: stages } = usePipelineStages(workspaceId, lead?.pipeline_id ?? null);
  const { data: leadCustomer } = useCustomerForLead(leadId);

  const [busy, setBusy] = useState(false);
  const [qualificationStatus, setQualificationStatus] = useState<QualificationStatus | null>(null);
  const [qualificationNotes, setQualificationNotes] = useState("");
  const [qualificationReason, setQualificationReason] = useState("");
  const [noteText, setNoteText] = useState("");
  const [showLostDialog, setShowLostDialog] = useState(false);
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [newOpportunityTitle, setNewOpportunityTitle] = useState("");
  const [customerSheetId, setCustomerSheetId] = useState<string | null>(null);
  const [showOpportunityForm, setShowOpportunityForm] = useState(!!autoOpenOpportunityForm);
  const [followUpAt, setFollowUpAt] = useState("");
  const [followUpNote, setFollowUpNote] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
    queryClient.invalidateQueries({ queryKey: ["leads", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["opportunities", "lead", leadId] });
  };

  if (!lead) {
    return (
      <SheetContent className="w-full sm:max-w-2xl">
        <SheetHeader><SheetTitle>Loading lead…</SheetTitle><SheetDescription className="sr-only">Loading lead details</SheetDescription></SheetHeader>
      </SheetContent>
    );
  }

  const effectiveQualificationStatus = qualificationStatus ?? lead.qualification_status;

  const handleSaveQualification = async () => {
    const validationError = validateQualificationChange(effectiveQualificationStatus, qualificationReason || lead.qualification_reason);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setBusy(true);
    try {
      await setLeadQualification(workspaceId, leadId, {
        qualificationStatus: effectiveQualificationStatus,
        qualificationNotes: qualificationNotes || lead.qualification_notes || undefined,
        qualificationReason: qualificationReason || lead.qualification_reason || undefined,
      });
      invalidate();
      toast.success("Qualification updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update qualification");
    } finally {
      setBusy(false);
    }
  };

  const handleAssign = async (staffId: string) => {
    setBusy(true);
    try {
      await assignLead(workspaceId, leadId, staffId);
      invalidate();
      toast.success("Lead assigned");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to assign this lead");
    } finally {
      setBusy(false);
    }
  };

  const handleMoveStage = async (stageId: string) => {
    if (!lead.pipeline_id) return;
    setBusy(true);
    try {
      await moveLeadStage(workspaceId, leadId, lead.pipeline_id, stageId);
      invalidate();
      toast.success("Stage updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to move this lead");
    } finally {
      setBusy(false);
    }
  };

  const handleScheduleFollowUp = async () => {
    if (!followUpAt) return;
    setBusy(true);
    try {
      await setLeadFollowUp(workspaceId, leadId, new Date(followUpAt).toISOString(), followUpNote.trim() || undefined);
      setFollowUpAt("");
      setFollowUpNote("");
      invalidate();
      toast.success("Follow-up scheduled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to schedule follow-up");
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteFollowUp = async () => {
    setBusy(true);
    try {
      await completeLeadFollowUp(workspaceId, leadId);
      invalidate();
      toast.success("Follow-up completed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to complete follow-up");
    } finally {
      setBusy(false);
    }
  };

  const handleMarkLost = async () => {
    setBusy(true);
    try {
      await markLeadLost(workspaceId, leadId, lostReason || undefined);
      invalidate();
      toast.success("Lead marked lost");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to mark this lead lost");
    } finally {
      setBusy(false);
      setShowLostDialog(false);
    }
  };

  const handleArchive = async (archive: boolean) => {
    setBusy(true);
    try {
      await (archive ? archiveLead(workspaceId, leadId) : restoreLead(workspaceId, leadId));
      invalidate();
      toast.success(archive ? "Lead archived" : "Lead restored");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : archive ? "Unable to archive this lead" : "Unable to restore this lead");
    } finally {
      setBusy(false);
      setShowArchiveDialog(false);
    }
  };

  const handleReopenLead = async () => {
    setBusy(true);
    try {
      await reopenLead(workspaceId, leadId);
      invalidate();
      toast.success("Lead reopened");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to reopen this lead");
    } finally {
      setBusy(false);
    }
  };

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    try {
      await addCrmNote(workspaceId, "lead", leadId, noteText.trim());
      setNoteText("");
      queryClient.invalidateQueries({ queryKey: ["crm-notes", "lead", leadId] });
      toast.success("Note added");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save this note");
    }
  };

  const handleCreateOpportunity = async () => {
    if (!newOpportunityTitle.trim()) return;
    setBusy(true);
    try {
      await createOpportunity(workspaceId, { leadId, title: newOpportunityTitle.trim() });
      setNewOpportunityTitle("");
      setShowOpportunityForm(false);
      invalidate();
      toast.success(`${opportunityLabel} created`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to create this ${opportunityLabel.toLowerCase()}`);
    } finally {
      setBusy(false);
    }
  };

  const handleMarkWon = async (opportunityId: string) => {
    setBusy(true);
    try {
      const result = await markOpportunityWon(workspaceId, opportunityId, { createCustomer: true });
      invalidate();
      toast.success(result.customer ? `${opportunityLabel} won - customer created` : `${opportunityLabel} won`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to mark this ${opportunityLabel.toLowerCase()} won`);
    } finally {
      setBusy(false);
    }
  };

  const handleMarkLostOpportunity = async (opportunityId: string) => {
    setBusy(true);
    try {
      await markOpportunityLost(workspaceId, opportunityId);
      invalidate();
      toast.success(`${opportunityLabel} lost`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to mark this ${opportunityLabel.toLowerCase()} lost`);
    } finally {
      setBusy(false);
    }
  };

  const handleReopenOpportunity = async (opportunityId: string) => {
    setBusy(true);
    try {
      await reopenOpportunity(workspaceId, opportunityId);
      invalidate();
      toast.success(`${opportunityLabel} reopened`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to reopen this ${opportunityLabel.toLowerCase()}`);
    } finally {
      setBusy(false);
    }
  };

  const now = new Date();
  const fu = followUpState(lead, now);
  const assignedName = lead.assigned_to ? (members || []).find((m) => m.user_id === lead.assigned_to)?.profile?.full_name || "Former member" : null;
  const stageName = lead.pipeline_stage_id ? (stages || []).find((s) => s.id === lead.pipeline_stage_id)?.name ?? null : null;
  const intake = intakeRows(lead.intake);
  const valueLabel = lead.estimated_value != null && Number(lead.estimated_value) > 0 ? `R ${Number(lead.estimated_value).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}` : null;
  const section = "space-y-3 border-b border-border px-4 py-4 sm:px-6";
  const heading = (text: string, action?: ReactNode) => (
    <div className="flex items-center gap-2">
      <h3 className="flex-1 text-overline uppercase text-muted-foreground">{text}</h3>
      {action}
    </div>
  );
  const fuTone = fu.kind === "overdue" ? "bg-destructive-soft text-destructive-strong" : fu.kind === "due_today" ? "bg-warning-soft text-warning" : "bg-muted text-foreground";

  return (
    <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
      <SheetHeader className="space-y-2 border-b border-border px-4 pb-4 pt-5 pr-12 text-left sm:px-6">
        <SheetTitle className="text-title-section">{lead.contact_name || lead.phone || lead.human_reference}</SheetTitle>
        <SheetDescription className="text-sm">{[lead.company_name, lead.human_reference].filter(Boolean).join(" · ")}</SheetDescription>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill tone={lead.status === "converted" ? "success" : lead.status === "lost" ? "neutral" : "info"} className="capitalize">{lead.status}</StatusPill>
          {lead.qualification_status !== "unqualified" && (
            <StatusPill tone={lead.qualification_status === "qualified" ? "success" : lead.qualification_status === "not_qualified" ? "neutral" : "warning"}>
              {qualificationStatusLabel(lead.qualification_status)}
            </StatusPill>
          )}
          {stageName && <StatusPill tone="neutral" dot={false}>{stageName}</StatusPill>}
          {lead.archived_at && <StatusPill tone="neutral" dot={false}>Archived</StatusPill>}
        </div>
        {(lead.phone || lead.email || leadCustomer) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {lead.phone && <Button asChild size="sm" variant="outline"><a href={`tel:${lead.phone}`}><Phone aria-hidden="true" />Call</a></Button>}
            {lead.phone && <Button asChild size="sm" variant="outline"><a href={`https://wa.me/${lead.phone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noreferrer"><MessageCircle aria-hidden="true" />WhatsApp</a></Button>}
            {lead.email && <Button asChild size="sm" variant="outline"><a href={`mailto:${lead.email}`}><Mail aria-hidden="true" />Email</a></Button>}
            {leadCustomer && (
              <Button asChild size="sm" variant="ghost"><Link to={`/app/customers/${leadCustomer.id}`}>Open Customer 360 - {leadCustomer.name}</Link></Button>
            )}
          </div>
        )}
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {lead.archived_at && (
          <p className="border-b border-border bg-muted/60 px-4 py-3 text-sm text-foreground sm:px-6" role="note">
            Archived on {new Date(lead.archived_at).toLocaleDateString()}. It is hidden from active lead views; its history is kept.
          </p>
        )}

        {lead.status === "active" && !lead.archived_at && (
          <section className={section} aria-label="Next action">
            {heading("Next action")}
            <div className={`rounded-xl px-3 py-2.5 ${fuTone}`}>
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
                {fu.kind === "overdue"
                  ? `Follow-up overdue${fu.days ? ` by ${fu.days} day${fu.days === 1 ? "" : "s"}` : ""}`
                  : fu.kind === "due_today"
                    ? "Follow-up due today"
                    : fu.kind === "upcoming"
                      ? "Follow-up scheduled"
                      : "No follow-up scheduled"}
              </p>
              {fu.kind !== "none" && <p className="mt-0.5 pl-[1.375rem] text-xs opacity-80">{fu.at.toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>}
              {lead.follow_up_note && <p className="mt-1 text-sm text-foreground">{lead.follow_up_note}</p>}
              {fu.kind === "none" && !assignedName && <p className="mt-1 text-xs text-muted-foreground">This lead also has no owner yet.</p>}
            </div>
            {canEdit && (
              <>
                {lead.next_follow_up_at && <Button size="sm" onClick={handleCompleteFollowUp} disabled={busy}><CheckCircle2 aria-hidden="true" /> Mark follow-up done</Button>}
                <div className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_1fr_auto]">
                  <Input type="datetime-local" value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} aria-label="Follow-up date and time" />
                  <Input placeholder="What should happen next?" value={followUpNote} onChange={(e) => setFollowUpNote(e.target.value)} maxLength={500} aria-label="Follow-up note" />
                  <Button variant="outline" onClick={handleScheduleFollowUp} disabled={busy || !followUpAt}>{lead.next_follow_up_at ? "Reschedule" : "Schedule"}</Button>
                </div>
              </>
            )}
          </section>
        )}

        <section className={section} aria-label="Details">
          {heading("Details")}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div className="grid gap-1">
              <dt className="text-xs text-muted-foreground">Owner</dt>
              <dd>
                {canAssign ? (
                  <Select value={lead.assigned_to || ""} onValueChange={handleAssign} disabled={busy}>
                    <SelectTrigger aria-label="Owner"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>
                      {(members || []).map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.profile?.full_name || "Unnamed"}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className={assignedName ? "text-foreground" : "font-medium text-warning"}>{assignedName ?? "Unassigned"}</span>
                )}
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="text-xs text-muted-foreground">Pipeline stage</dt>
              <dd>
                {canEdit && lead.pipeline_id ? (
                  <Select value={lead.pipeline_stage_id || ""} onValueChange={handleMoveStage} disabled={busy}>
                    <SelectTrigger aria-label="Pipeline stage"><SelectValue placeholder="No stage" /></SelectTrigger>
                    <SelectContent>
                      {(stages || []).map((st) => <SelectItem key={st.id} value={st.id}>{st.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="text-foreground">{stageName ?? "No stage"}</span>
                )}
              </dd>
            </div>
            <div className="grid gap-1"><dt className="text-xs text-muted-foreground">Estimated value</dt><dd className="text-foreground">{valueLabel ?? <span className="text-muted-foreground">Not set</span>}</dd></div>
            <div className="grid gap-1"><dt className="text-xs text-muted-foreground">Source</dt><dd className="text-foreground">{sourceLabel(lead.source)}{lead.source_detail ? ` (${lead.source_detail})` : ""}</dd></div>
            {lead.phone && <div className="grid gap-1"><dt className="text-xs text-muted-foreground">Phone</dt><dd className="break-words text-foreground">{lead.phone}</dd></div>}
            {lead.email && <div className="grid gap-1"><dt className="text-xs text-muted-foreground">Email</dt><dd className="break-words text-foreground">{lead.email}</dd></div>}
            {lead.company_name && <div className="grid gap-1"><dt className="text-xs text-muted-foreground">Company</dt><dd className="text-foreground">{lead.company_name}</dd></div>}
            <div className="grid gap-1"><dt className="text-xs text-muted-foreground">Created</dt><dd className="text-foreground">{new Date(lead.created_at).toLocaleDateString()}</dd></div>
          </dl>
          {lead.created_from_conversation_id && (
            <p className="flex items-center gap-1.5 text-sm">
              <MessageCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Link to="/app/whatsapp/inbox" state={{ selectedId: lead.created_from_conversation_id }} className="font-medium text-link underline-offset-2 hover:underline">
                Open the originating WhatsApp conversation
              </Link>
            </p>
          )}
        </section>

        <section className={section} aria-label="Activity and notes">
          {heading("Activity & notes")}
          {canEdit && (
            <div className="flex gap-2">
              <Input placeholder="Add a note" value={noteText} onChange={(e) => setNoteText(e.target.value)} aria-label="Add a note" onKeyDown={(e) => e.key === "Enter" && handleAddNote()} />
              <Button variant="outline" onClick={handleAddNote} disabled={!noteText.trim()}>Add</Button>
            </div>
          )}
          {(notes || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No notes yet.</p>
          ) : (
            <ol className="space-y-2">
              {(notes || []).map((n) => (
                <li key={n.id} className="rounded-lg bg-muted/70 px-3 py-2">
                  <p className="text-xs text-muted-foreground">{n.author_name}{n.created_at ? ` · ${new Date(n.created_at).toLocaleString()}` : ""}</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{n.body}</p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className={section} aria-label={pluralizeLabel(opportunityLabel)}>
          {heading(
            pluralizeLabel(opportunityLabel),
            canCreateOpportunity ? <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-link" onClick={() => setShowOpportunityForm((v) => !v)}>{openOpportunityActionLabel({ opportunity_label: opportunityLabel })}</Button> : undefined,
          )}
          {showOpportunityForm && (
            <div className="flex gap-2">
              <Input placeholder={`${opportunityLabel} title`} value={newOpportunityTitle} onChange={(e) => setNewOpportunityTitle(e.target.value)} aria-label={`${opportunityLabel} title`} />
              <Button onClick={handleCreateOpportunity} disabled={busy || !newOpportunityTitle.trim()}>Create</Button>
            </div>
          )}
          {(opportunities || []).length === 0 && !showOpportunityForm && (
            <p className="text-sm text-muted-foreground">No {opportunityLabel.toLowerCase()} yet. Create one when this lead is ready to progress.</p>
          )}
          {(opportunities || []).map((o) => (
            <div key={o.id} className="space-y-2 rounded-lg border border-border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-foreground">{o.title}</p>
                <StatusPill tone={o.status === "won" ? "success" : o.status === "open" ? "info" : "neutral"}>{opportunityStatusLabel(o.status)}</StatusPill>
              </div>
              {o.estimated_value != null && <p className="text-xs text-muted-foreground">Est. value: {o.estimated_value}</p>}
              {o.actual_value != null && <p className="text-xs text-muted-foreground">Actual deal value: {o.actual_value}</p>}
              <AttributionSourceSummary workspaceId={workspaceId} targetType="opportunity" targetId={o.id} compact fallbackLabel="Inherited from the lead - no direct attribution recorded on this opportunity." />
              {canCloseOpportunity && o.status === "open" && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => handleMarkWon(o.id)} disabled={busy}><Trophy aria-hidden="true" /> Won</Button>
                  <Button size="sm" variant="outline" onClick={() => handleMarkLostOpportunity(o.id)} disabled={busy}>Lost</Button>
                </div>
              )}
              {canCloseOpportunity && o.status !== "open" && (
                <Button size="sm" variant="outline" onClick={() => handleReopenOpportunity(o.id)} disabled={busy}>Reopen</Button>
              )}
              {o.status === "won" && (
                <WonOpportunityRevenue workspaceId={workspaceId} opportunityId={o.id} leadId={leadId} canRecordRevenue={canRecordRevenue} onViewCustomer={setCustomerSheetId} />
              )}
            </div>
          ))}
        </section>

        {(lead.summary || intake.length > 0) && (
          <section className={section} aria-label="What the customer told us">
            {heading("What the customer told us")}
            {lead.summary && <p className="whitespace-pre-wrap text-sm text-foreground">{lead.summary}</p>}
            {intake.length > 0 && (
              <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-3 gap-y-1.5 text-sm">
                {intake.map((r) => (
                  <div key={r.key} className="contents">
                    <dt className="truncate text-muted-foreground">{r.label}</dt>
                    <dd className="min-w-0 break-words text-foreground">{r.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        )}

        {canEdit && (
          <section className={section} aria-label="Qualification">
            {heading("Qualification")}
            <Select value={effectiveQualificationStatus} onValueChange={(v) => setQualificationStatus(v as QualificationStatus)} disabled={busy}>
              <SelectTrigger aria-label="Qualification status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {QUALIFICATION_STATUSES.map((st) => <SelectItem key={st} value={st}>{qualificationStatusLabel(st)}</SelectItem>)}
              </SelectContent>
            </Select>
            {effectiveQualificationStatus === "not_qualified" && (
              <Input placeholder="Reason not qualified" defaultValue={lead.qualification_reason || ""} onChange={(e) => setQualificationReason(e.target.value)} aria-label="Reason not qualified" />
            )}
            <Textarea placeholder="Qualification notes" defaultValue={lead.qualification_notes || ""} onChange={(e) => setQualificationNotes(e.target.value)} aria-label="Qualification notes" className="min-h-[64px]" />
            <Button variant="outline" onClick={handleSaveQualification} disabled={busy}>Save qualification</Button>
          </section>
        )}

        <section className={section} aria-label="Attribution">
          {heading("Attribution")}
          <AttributionSourceSummary
            workspaceId={workspaceId}
            targetType="lead"
            targetId={leadId}
            fallbackLabel={lead.source === "manual" || lead.source === "referral" ? "Manually entered - no campaign attribution." : "No attribution evidence recorded."}
          />
        </section>

        <div className={canViewAttachments ? section : "hidden"}>
          <LeadDocuments workspaceId={workspaceId} leadId={leadId} canView={canViewAttachments} />
        </div>

        {(canEdit || canArchive) && (
          <section className="flex flex-wrap gap-2 px-4 py-4 sm:px-6" aria-label="Lead actions">
            {!canEdit || lead.archived_at ? null : lead.status === "lost" ? (
              <Button size="sm" variant="outline" onClick={handleReopenLead} disabled={busy}>Reopen lead</Button>
            ) : lead.status === "active" ? (
              <Button size="sm" variant="outline" onClick={() => setShowLostDialog(true)} disabled={busy}><XCircle aria-hidden="true" /> Mark lead lost</Button>
            ) : null}
            {canArchive && (lead.archived_at ? (
              <Button size="sm" variant="outline" onClick={() => handleArchive(false)} disabled={busy}><ArchiveRestore aria-hidden="true" /> Restore lead</Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setShowArchiveDialog(true)} disabled={busy}><Archive aria-hidden="true" /> Archive lead</Button>
            ))}
          </section>
        )}
      </div>

      <AlertDialog open={showLostDialog} onOpenChange={setShowLostDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark this lead as lost?</AlertDialogTitle>
            <AlertDialogDescription>This lead won't appear in active pipeline views. You can reopen it later.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Select value={lostReason} onValueChange={setLostReason}>
              <SelectTrigger><SelectValue placeholder="Choose a reason (optional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="No response">No response</SelectItem>
                <SelectItem value="Price / budget">Price / budget</SelectItem>
                <SelectItem value="Chose a competitor">Chose a competitor</SelectItem>
                <SelectItem value="Not qualified">Not qualified</SelectItem>
                <SelectItem value="Postponed">Postponed</SelectItem>
                <SelectItem value="No longer interested">No longer interested</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="Or type another reason" value={lostReason} onChange={(e) => setLostReason(e.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleMarkLost}>Mark lost</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showArchiveDialog} onOpenChange={setShowArchiveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this lead?</AlertDialogTitle>
            <AlertDialogDescription>The lead will be removed from active views but its history will be retained. You can restore it from the Archived filter.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleArchive(true)} disabled={busy}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={!!customerSheetId} onOpenChange={(v) => { if (!v) setCustomerSheetId(null); }}>
        {customerSheetId && <CustomerDetail workspaceId={workspaceId} customerId={customerSheetId} canRecordRevenue={canRecordRevenue} />}
      </Sheet>
    </SheetContent>
  );
}

import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Trophy, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { useLead, usePipelineStages } from "@/hooks/useLeads";
import { useOpportunitiesForLead, useCrmNotes, useCustomerForOpportunity } from "@/hooks/useOpportunities";
import { QUALIFICATION_STATUSES, qualificationStatusLabel, validateQualificationChange, type QualificationStatus } from "@/lib/qualification";
import { opportunityStatusLabel } from "@/lib/opportunityLifecycle";
import { openOpportunityActionLabel, pluralizeLabel } from "@/lib/terminology";
import {
  addCrmNote, assignLead, createOpportunity, markLeadLost, markOpportunityLost, markOpportunityWon,
  moveLeadStage, reopenLead, reopenOpportunity, setLeadQualification,
} from "@/lib/leads";
import { AttributionSourceSummary } from "@/components/attribution/AttributionSourceSummary";
import { RevenueSection } from "@/components/attribution/RevenueSection";

const LEAD_STATUS_TONE: Record<string, string> = {
  active: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  converted: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  lost: "bg-muted text-muted-foreground",
};

const OPPORTUNITY_STATUS_TONE: Record<string, string> = {
  open: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  won: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  lost: "bg-muted text-muted-foreground",
};

function WonOpportunityRevenue({ workspaceId, opportunityId, leadId, canRecordRevenue }: { workspaceId: string; opportunityId: string; leadId: string; canRecordRevenue: boolean }) {
  const { data: customer } = useCustomerForOpportunity(opportunityId);
  return (
    <RevenueSection workspaceId={workspaceId} opportunityId={opportunityId} customerId={customer?.id ?? null} leadId={leadId} canRecord={canRecordRevenue} />
  );
}

export function LeadDetail({ workspaceId, leadId, canEdit, canAssign, canCreateOpportunity, canCloseOpportunity, canRecordRevenue, opportunityLabel, autoOpenOpportunityForm }: {
  workspaceId: string;
  leadId: string;
  canEdit: boolean;
  canAssign: boolean;
  canCreateOpportunity: boolean;
  canCloseOpportunity: boolean;
  canRecordRevenue: boolean;
  opportunityLabel: string;
  autoOpenOpportunityForm?: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: lead } = useLead(leadId);
  const { data: members } = useWorkspaceMembers(workspaceId);
  const { data: opportunities } = useOpportunitiesForLead(leadId);
  const { data: notes } = useCrmNotes("lead", leadId);
  const { data: stages } = usePipelineStages(workspaceId, lead?.pipeline_id ?? null);

  const [busy, setBusy] = useState(false);
  const [qualificationStatus, setQualificationStatus] = useState<QualificationStatus | null>(null);
  const [qualificationNotes, setQualificationNotes] = useState("");
  const [qualificationReason, setQualificationReason] = useState("");
  const [noteText, setNoteText] = useState("");
  const [showLostDialog, setShowLostDialog] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [newOpportunityTitle, setNewOpportunityTitle] = useState("");
  const [showOpportunityForm, setShowOpportunityForm] = useState(!!autoOpenOpportunityForm);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
    queryClient.invalidateQueries({ queryKey: ["leads", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["opportunities", "lead", leadId] });
  };

  if (!lead) {
    return (
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader><SheetTitle>Loading...</SheetTitle></SheetHeader>
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

  return (
    <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
      <SheetHeader className="text-left">
        <div className="flex items-center gap-2">
          <SheetTitle>{lead.contact_name || lead.human_reference}</SheetTitle>
          <Badge variant="secondary" className={LEAD_STATUS_TONE[lead.status]}>{lead.status}</Badge>
        </div>
        <SheetDescription>{lead.human_reference}</SheetDescription>
      </SheetHeader>

      <div className="mt-4 space-y-6">
        <section className="space-y-1 text-sm">
          {lead.phone && <p><span className="text-muted-foreground">Phone:</span> {lead.phone}</p>}
          {lead.email && <p><span className="text-muted-foreground">Email:</span> {lead.email}</p>}
          {lead.company_name && <p><span className="text-muted-foreground">Company:</span> {lead.company_name}</p>}
          <p><span className="text-muted-foreground">Source:</span> {lead.source}{lead.source_detail ? ` (${lead.source_detail})` : ""}</p>
          {lead.created_from_conversation_id && (
            <p className="flex items-center gap-1 text-muted-foreground"><MessageCircle className="h-3.5 w-3.5" /> Linked to a WhatsApp conversation</p>
          )}
        </section>

        <section>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Attribution</p>
          <AttributionSourceSummary
            workspaceId={workspaceId}
            targetType="lead"
            targetId={leadId}
            fallbackLabel={lead.source === "manual" || lead.source === "referral" ? "Manually entered - no campaign attribution." : "No attribution evidence recorded."}
          />
        </section>

        {canAssign && (
          <section>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Assigned to</p>
            <Select value={lead.assigned_to || ""} onValueChange={handleAssign} disabled={busy}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent>
                {(members || []).map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.profile?.full_name || "Unnamed"}</SelectItem>)}
              </SelectContent>
            </Select>
          </section>
        )}

        {canEdit && (
          <section className="space-y-2 rounded-md border p-3">
            <p className="text-xs font-medium text-muted-foreground">Qualification</p>
            <Select value={effectiveQualificationStatus} onValueChange={(v) => setQualificationStatus(v as QualificationStatus)} disabled={busy}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {QUALIFICATION_STATUSES.map((s) => <SelectItem key={s} value={s}>{qualificationStatusLabel(s)}</SelectItem>)}
              </SelectContent>
            </Select>
            {effectiveQualificationStatus === "not_qualified" && (
              <Input placeholder="Reason not qualified" defaultValue={lead.qualification_reason || ""} onChange={(e) => setQualificationReason(e.target.value)} className="h-8 text-xs" />
            )}
            <Textarea placeholder="Qualification notes" defaultValue={lead.qualification_notes || ""} onChange={(e) => setQualificationNotes(e.target.value)} className="min-h-[60px] text-xs" />
            <Button size="sm" variant="outline" onClick={handleSaveQualification} disabled={busy}>Save qualification</Button>
          </section>
        )}

        {canEdit && lead.pipeline_id && (
          <section>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Pipeline stage</p>
            <Select value={lead.pipeline_stage_id || ""} onValueChange={handleMoveStage} disabled={busy}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="No stage" /></SelectTrigger>
              <SelectContent>
                {(stages || []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </section>
        )}

        {canEdit && (
          <section className="flex gap-2">
            {lead.status === "lost" ? (
              <Button size="sm" variant="outline" onClick={handleReopenLead} disabled={busy}>Reopen lead</Button>
            ) : lead.status === "active" ? (
              <Button size="sm" variant="outline" onClick={() => setShowLostDialog(true)} disabled={busy}><XCircle className="mr-1.5 h-3.5 w-3.5" /> Mark lead lost</Button>
            ) : null}
          </section>
        )}

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">{pluralizeLabel(opportunityLabel)}</p>
            {canCreateOpportunity && (
              <Button size="sm" variant="ghost" onClick={() => setShowOpportunityForm((v) => !v)}>{openOpportunityActionLabel({ opportunity_label: opportunityLabel })}</Button>
            )}
          </div>
          {showOpportunityForm && (
            <div className="flex gap-2">
              <Input placeholder={`${opportunityLabel} title`} value={newOpportunityTitle} onChange={(e) => setNewOpportunityTitle(e.target.value)} className="h-8 text-xs" />
              <Button size="sm" onClick={handleCreateOpportunity} disabled={busy || !newOpportunityTitle.trim()}>Create</Button>
            </div>
          )}
          {(opportunities || []).length === 0 && !showOpportunityForm && (
            <p className="text-xs text-muted-foreground">No {opportunityLabel.toLowerCase()} yet. Create one when this lead is ready to progress.</p>
          )}
          {(opportunities || []).map((o) => (
            <div key={o.id} className="space-y-2 rounded-md border p-2 text-xs">
              <div className="flex items-center justify-between">
                <p className="font-medium">{o.title}</p>
                <Badge variant="secondary" className={OPPORTUNITY_STATUS_TONE[o.status]}>{opportunityStatusLabel(o.status)}</Badge>
              </div>
              {o.estimated_value != null && <p className="text-muted-foreground">Est. value: {o.estimated_value}</p>}
              {o.actual_value != null && <p className="text-muted-foreground">Actual deal value: {o.actual_value}</p>}
              <AttributionSourceSummary workspaceId={workspaceId} targetType="opportunity" targetId={o.id} compact fallbackLabel="Inherited from the lead - no direct attribution recorded on this opportunity." />
              {canCloseOpportunity && o.status === "open" && (
                <div className="mt-1 flex gap-2">
                  <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => handleMarkWon(o.id)} disabled={busy}><Trophy className="mr-1 h-3 w-3" /> Won</Button>
                  <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => handleMarkLostOpportunity(o.id)} disabled={busy}>Lost</Button>
                </div>
              )}
              {canCloseOpportunity && o.status !== "open" && (
                <Button size="sm" variant="outline" className="mt-1 h-7 px-2" onClick={() => handleReopenOpportunity(o.id)} disabled={busy}>Reopen</Button>
              )}
              {o.status === "won" && (
                <WonOpportunityRevenue workspaceId={workspaceId} opportunityId={o.id} leadId={leadId} canRecordRevenue={canRecordRevenue} />
              )}
            </div>
          ))}
        </section>

        <section className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Notes</p>
          {(notes || []).map((n) => (
            <p key={n.id} className="rounded-md bg-amber-50 p-2 text-xs dark:bg-amber-950/20"><span className="font-medium">{n.author_name}:</span> {n.body}</p>
          ))}
          {canEdit && (
            <div className="flex gap-2">
              <Input placeholder="Add a note" value={noteText} onChange={(e) => setNoteText(e.target.value)} className="h-8 text-xs" onKeyDown={(e) => e.key === "Enter" && handleAddNote()} />
              <Button size="sm" variant="ghost" onClick={handleAddNote} disabled={!noteText.trim()}>Add</Button>
            </div>
          )}
        </section>
      </div>

      <AlertDialog open={showLostDialog} onOpenChange={setShowLostDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark this lead as lost?</AlertDialogTitle>
            <AlertDialogDescription>This lead won't appear in active pipeline views. You can reopen it later.</AlertDialogDescription>
          </AlertDialogHeader>
          <Input placeholder="Reason (optional)" value={lostReason} onChange={(e) => setLostReason(e.target.value)} />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleMarkLost}>Mark lost</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SheetContent>
  );
}

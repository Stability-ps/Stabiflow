import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Bot, Briefcase, CheckCircle2, Paperclip, Send, Sparkles, UserCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { getInboxMediaUrl, useInboxInternalNotes, useInboxMessages, type InboxMessageRow } from "@/hooks/useInboxMessages";
import type { InboxConversationRow } from "@/hooks/useInboxConversations";
import { useLead, usePipelines, usePipelineStages } from "@/hooks/useLeads";
import { useOpportunitiesForLead, useCustomer } from "@/hooks/useOpportunities";
import { useCustomerMatchCandidates, useCustomersSearch } from "@/hooks/useCustomers";
import { linkConversationCustomer, unlinkConversationCustomer } from "@/lib/customer";
import { addInternalNote, assignConversation, markConversationRead, replyToConversation, replyWithTemplate, reopenConversation, resolveConversation, returnConversationToAI } from "@/lib/inbox";
import { aiHumanStatusText, buildMissingInfoReply, computeMessagingWindowState, deliveryLabel, deliveryTone, inboxStatusLabel, messagingWindowLabel, priorityLabel } from "@/lib/inboxPresentation";
import { approvedTemplates, templateBodyParameterCount, useInboxTemplates } from "@/hooks/useInboxTemplates";
import { roleHasPermission } from "@/lib/permissions";
import { createLeadFromConversation, createOpportunity, linkLeadConversation, type DuplicateLeadCandidate } from "@/lib/leads";
import { intakeRows } from "@/lib/intakeDisplay";
import { previewAskInfo, sendAskInfo, setIntakeAnswer, type AskInfoPreview } from "@/lib/intake";
import { useIntakeSchemas, resolveConversationSchema } from "@/hooks/useIntakeSchemas";
import { evaluateIntake, readIntakePayload } from "@/lib/intakeSchema";
import { qualificationStatusLabel } from "@/lib/qualification";
import { useOpportunityTerminology } from "@/hooks/useOpportunityTerminology";
import { openOpportunityActionLabel } from "@/lib/terminology";
import { AttributionSourceSummary } from "@/components/attribution/AttributionSourceSummary";

function MessageBubble({ message }: { message: InboxMessageRow }) {
  const isInbound = message.direction === "inbound";
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);

  useEffect(() => {
    if (message.media_storage_path) getInboxMediaUrl(message.media_storage_path).then(setMediaUrl);
  }, [message.media_storage_path]);

  const senderLabel = isInbound ? null : message.sender_type === "ai" ? "AI" : message.sender_type === "system" ? "System" : message.staff_sender_name || "Staff";

  return (
    <div className={`flex ${isInbound ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${isInbound ? "bg-muted" : "bg-primary text-primary-foreground"}`}>
        {senderLabel && <p className="mb-0.5 text-xs opacity-70">{senderLabel}</p>}
        {message.media_storage_path && (
          <div className="mb-1">
            {mediaUrl ? (
              message.media_mime_type?.startsWith("image/") ? (
                <img src={mediaUrl} alt={message.media_filename || "attachment"} className="max-h-48 rounded" />
              ) : (
                <a href={mediaUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 underline"><Paperclip className="h-3 w-3" /> {message.media_filename || "Attachment"}</a>
              )
            ) : (
              <p className="flex items-center gap-1 text-xs opacity-70"><Paperclip className="h-3 w-3" /> Loading attachment...</p>
            )}
          </div>
        )}
        <p className="whitespace-pre-wrap">{message.content}</p>
        {!isInbound && message.delivery_status && (
          <p className={`mt-1 text-[11px] ${deliveryTone(message.delivery_status) === "error" ? "text-red-200" : "opacity-70"}`}>{deliveryLabel(message.delivery_status)}</p>
        )}
      </div>
    </div>
  );
}

export function ConversationDetail({ workspaceId, conversation, canManage, onBack, onChanged }: {
  workspaceId: string;
  conversation: InboxConversationRow;
  canManage: boolean;
  onBack?: () => void;
  onChanged: () => void;
}) {
  const { user, currentMembership } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: messages, isLoading: messagesLoading } = useInboxMessages(conversation.id);
  const { data: notes } = useInboxInternalNotes(conversation.id);
  const { data: members } = useWorkspaceMembers(workspaceId);
  const { data: lead } = useLead(conversation.lead_id);
  const { data: leadOpportunities } = useOpportunitiesForLead(conversation.lead_id);
  const { data: templates } = useInboxTemplates(workspaceId);
  const opportunityLabel = useOpportunityTerminology(workspaceId);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const role = currentMembership?.role;
  const canCreateLead = roleHasPermission(role, "lead.create");
  const canViewLead = roleHasPermission(role, "lead.view");
  const canCreateOpportunity = roleHasPermission(role, "opportunity.create");

  // What the AI has learned - prefer the lead's persisted copy once a lead
  // exists, otherwise the live conversation payload.
  const learnedSummary = lead?.summary || conversation.ai_summary || null;
  const learnedIntake = useMemo(
    () => intakeRows(conversation.lead_id && lead ? lead.intake : conversation.intake_payload).slice(0, 6),
    [conversation.lead_id, conversation.intake_payload, lead],
  );
  const ownerName = lead?.assigned_to ? (members || []).find((m) => m.user_id === lead.assigned_to)?.profile?.full_name || "Assigned" : null;
  const latestOpportunity = (leadOpportunities || [])[0] || null;

  // Phase 3: structured intake. When the workspace has an active schema
  // that governs this conversation, show collected / missing / needs-
  // clarification against it and drive the real Ask Info flow.
  const { data: intakeData } = useIntakeSchemas(canManage ? workspaceId : null);
  const { schema: intakeSchema, fields: intakeFields } = useMemo(
    () => resolveConversationSchema(intakeData, conversation.intake_schema_id),
    [intakeData, conversation.intake_schema_id],
  );
  const intakeEval = useMemo(() => {
    if (!intakeSchema || intakeFields.length === 0) return null;
    const source = conversation.lead_id && lead ? lead.intake : conversation.intake_payload;
    return evaluateIntake(intakeFields, readIntakePayload(source).fields);
  }, [intakeSchema, intakeFields, conversation.lead_id, conversation.intake_payload, lead]);

  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [confirmResolve, setConfirmResolve] = useState(false);
  const [confirmReturnToAI, setConfirmReturnToAI] = useState(false);
  const [busy, setBusy] = useState(false);
  const [creatingLead, setCreatingLead] = useState(false);
  const [leadDuplicates, setLeadDuplicates] = useState<DuplicateLeadCandidate[] | null>(null);
  const [copyContextOnLink, setCopyContextOnLink] = useState(true);
  const [askInfoPreview, setAskInfoPreview] = useState<AskInfoPreview | null>(null);
  const [askingInfo, setAskingInfo] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  // Create-opportunity dialog (Part D) - reuses the existing
  // leads-actions create_opportunity path, never a second workflow.
  const [oppDialogOpen, setOppDialogOpen] = useState(false);
  const [oppTitle, setOppTitle] = useState("");
  const [oppPipelineId, setOppPipelineId] = useState("");
  const [oppStageId, setOppStageId] = useState("");
  const [oppOwnerId, setOppOwnerId] = useState("");
  const [oppValue, setOppValue] = useState("");
  const [creatingOpp, setCreatingOpp] = useState(false);
  const { data: pipelines } = usePipelines(canCreateOpportunity ? workspaceId : null);
  const { data: oppStages } = usePipelineStages(workspaceId, oppPipelineId || lead?.pipeline_id || null);
  const { data: leadStages } = usePipelineStages(canViewLead ? workspaceId : null, lead?.pipeline_id ?? null);
  const leadStageName = lead?.pipeline_stage_id ? (leadStages || []).find((s) => s.id === lead.pipeline_stage_id)?.name ?? null : null;

  // Phase L-1: display-only indicator, computed client-side from the
  // already-fetched last_inbound_at - the actual send is always re-checked
  // server-side against the real message log regardless of this value.
  const windowState = computeMessagingWindowState(conversation.last_inbound_at);
  const windowOpen = windowState === "open";
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateParams, setTemplateParams] = useState<string[]>([]);
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const usableTemplates = approvedTemplates(templates);
  const selectedTemplate = usableTemplates.find((t) => t.id === selectedTemplateId) || null;

  useEffect(() => {
    // A fresh inbound message reopens the window - drop any half-filled
    // template draft rather than leaving a stale one selected once normal
    // replies become available again.
    if (windowOpen) {
      setSelectedTemplateId("");
      setTemplateParams([]);
    }
  }, [windowOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length]);

  useEffect(() => {
    markConversationRead(workspaceId, conversation.id).catch(() => {});
  }, [workspaceId, conversation.id]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["inbox-conversations", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["inbox-messages", conversation.id] });
    onChanged();
  };

  const handleAssign = async (staffId: string) => {
    setBusy(true);
    try {
      await assignConversation(workspaceId, conversation.id, staffId);
      invalidate();
      toast.success("Conversation assigned");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to assign this conversation");
    } finally {
      setBusy(false);
    }
  };

  const handleReturnToAI = async () => {
    setBusy(true);
    try {
      await returnConversationToAI(workspaceId, conversation.id);
      invalidate();
      toast.success("Returned to AI");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to return this conversation to AI");
    } finally {
      setBusy(false);
      setConfirmReturnToAI(false);
    }
  };

  const handleResolve = async () => {
    setBusy(true);
    try {
      await resolveConversation(workspaceId, conversation.id);
      invalidate();
      toast.success("Conversation resolved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to resolve this conversation");
    } finally {
      setBusy(false);
      setConfirmResolve(false);
    }
  };

  const handleReopen = async () => {
    setBusy(true);
    try {
      await reopenConversation(workspaceId, conversation.id);
      invalidate();
      toast.success("Conversation reopened");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to reopen this conversation");
    } finally {
      setBusy(false);
    }
  };

  const handleSend = async () => {
    if (!replyText.trim()) return;
    setSending(true);
    try {
      const result = await replyToConversation(workspaceId, conversation.id, replyText.trim());
      setReplyText("");
      invalidate();
      if (result.delivery_status === "failed") toast.error(result.warning || "The message was saved but could not be delivered");
      else toast.success("Reply sent");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to send this reply");
    } finally {
      setSending(false);
    }
  };

  const handleSelectTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const template = usableTemplates.find((t) => t.id === templateId);
    setTemplateParams(template ? Array(templateBodyParameterCount(template)).fill("") : []);
  };

  const handleSendTemplate = async () => {
    if (!selectedTemplate) return;
    setSendingTemplate(true);
    try {
      const result = await replyWithTemplate(workspaceId, conversation.id, selectedTemplate.id, templateParams);
      setSelectedTemplateId("");
      setTemplateParams([]);
      invalidate();
      if (result.delivery_status === "failed") toast.error(result.warning || "The template was saved but could not be delivered");
      else toast.success("Template sent");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to send this template");
    } finally {
      setSendingTemplate(false);
    }
  };

  // No active schema: keep the Phase-D behaviour of dropping a canned
  // "here's what we still need" draft into the reply box for staff to edit.
  const handleAskMissingInfo = () => {
    const draft = buildMissingInfoReply(conversation.intake_missing_fields || []);
    if (draft) setReplyText(draft);
  };

  // Active schema: real Ask Info. Step 1 - fetch the EXACT next question
  // (never sends). Step 2 (dialog confirm) - send it through the same safe
  // path as a staff reply.
  const handleAskNextQuestion = async () => {
    setAskingInfo(true);
    try {
      const preview = await previewAskInfo(workspaceId, conversation.id);
      if (!preview.next_question) {
        toast.info(preview.complete ? "Every required detail is already collected." : "There's no question to ask right now.");
        return;
      }
      setAskInfoPreview(preview);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to work out the next question");
    } finally {
      setAskingInfo(false);
    }
  };

  const handleConfirmAskInfo = async () => {
    setAskingInfo(true);
    try {
      const result = await sendAskInfo(workspaceId, conversation.id);
      setAskInfoPreview(null);
      invalidate();
      if (result.delivery_status === "failed") toast.error(result.warning || "The question was saved but could not be delivered");
      else toast.success("Question sent");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to send the question");
    } finally {
      setAskingInfo(false);
    }
  };

  const handleCorrectAnswer = async (fieldKey: string, value: unknown) => {
    setEditingKey(null);
    try {
      await setIntakeAnswer(workspaceId, conversation.id, fieldKey, value);
      invalidate();
      if (conversation.lead_id) queryClient.invalidateQueries({ queryKey: ["lead", conversation.lead_id] });
      toast.success("Answer updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update that answer");
    }
  };

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    try {
      await addInternalNote(workspaceId, conversation.id, noteText.trim());
      setNoteText("");
      queryClient.invalidateQueries({ queryKey: ["inbox-internal-notes", conversation.id] });
      toast.success("Note added");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save this note");
    }
  };

  const isAssignedToMe = conversation.assigned_staff_id === user?.id;

  const handleCreateLead = async (force = false) => {
    setCreatingLead(true);
    try {
      const result = await createLeadFromConversation(workspaceId, conversation.id, force);
      if (!result.created && result.duplicates?.length) {
        setLeadDuplicates(result.duplicates);
        return;
      }
      setLeadDuplicates(null);
      queryClient.invalidateQueries({ queryKey: ["inbox-conversations", workspaceId] });
      toast.success(
        result.created
          ? "Lead created"
          : result.completed_pending
            ? "Finished setting up the lead from this conversation"
            : "This conversation already has a linked lead",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create a lead");
    } finally {
      setCreatingLead(false);
    }
  };

  const goToLead = (leadId: string, openOpportunityForm = false) => {
    navigate("/app/leads", { state: { selectedLeadId: leadId, openOpportunityForm } });
  };

  const handleLinkExisting = async (leadId: string) => {
    setCreatingLead(true);
    try {
      const result = await linkLeadConversation(workspaceId, leadId, conversation.id, { applyContext: copyContextOnLink });
      setLeadDuplicates(null);
      queryClient.invalidateQueries({ queryKey: ["inbox-conversations", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
      queryClient.invalidateQueries({ queryKey: ["lead-attachments", leadId] });
      const ctx = result.context;
      const bits: string[] = [];
      if (ctx?.attachments_linked) bits.push(`${ctx.attachments_linked} document${ctx.attachments_linked === 1 ? "" : "s"}`);
      if (ctx?.summary_copied) bits.push("AI summary");
      if (ctx && (ctx.intake_new_keys?.length ?? 0) > 0) bits.push("intake answers");
      toast.success(bits.length ? `Linked to the lead - copied ${bits.join(", ")}.` : "Conversation linked to existing lead");
      if (ctx?.summary_skipped) toast.info("This lead already has a summary, so the conversation's was kept in the intake answers instead.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to link this conversation");
    } finally {
      setCreatingLead(false);
    }
  };

  const openOppDialog = () => {
    setOppTitle(conversation.display_name ? `${conversation.display_name} - ${opportunityLabel.toLowerCase()}` : `New ${opportunityLabel.toLowerCase()}`);
    setOppPipelineId(lead?.pipeline_id || (pipelines || []).find((p) => p.is_default)?.id || (pipelines || [])[0]?.id || "");
    setOppStageId(lead?.pipeline_stage_id || "");
    setOppOwnerId(lead?.assigned_to || "");
    setOppValue(lead?.estimated_value != null ? String(lead.estimated_value) : "");
    setOppDialogOpen(true);
  };

  const handleCreateOpportunity = async () => {
    if (!conversation.lead_id || !oppTitle.trim()) return;
    setCreatingOpp(true);
    try {
      const parsedValue = oppValue.trim() ? Number(oppValue.trim()) : undefined;
      await createOpportunity(workspaceId, {
        leadId: conversation.lead_id,
        title: oppTitle.trim(),
        pipelineId: oppPipelineId || undefined,
        pipelineStageId: oppStageId || undefined,
        assignedTo: oppOwnerId || undefined,
        estimatedValue: parsedValue != null && Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : undefined,
      });
      setOppDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["opportunities", "lead", conversation.lead_id] });
      toast.success(`${opportunityLabel} created`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to create this ${opportunityLabel.toLowerCase()}`);
    } finally {
      setCreatingOpp(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b p-3">
        {onBack && <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{conversation.display_name || conversation.phone_number}</p>
          <p className="truncate text-xs text-muted-foreground">{conversation.phone_number}</p>
        </div>
        <Badge variant="secondary">{inboxStatusLabel(conversation.inbox_status)}</Badge>
        {conversation.priority_level !== "normal" && <Badge variant="secondary">{priorityLabel(conversation.priority_level)}</Badge>}
        <Badge variant={windowState === "open" ? "outline" : "destructive"}>{messagingWindowLabel(windowState)}</Badge>
      </div>

      <div className="border-b p-2">
        <AttributionSourceSummary workspaceId={workspaceId} targetType="conversation" targetId={conversation.id} compact fallbackLabel="Direct WhatsApp - no ad referral." />
      </div>

      {roleHasPermission(role, "opportunity.view") && (
        <ConversationCustomerPanel workspaceId={workspaceId} conversation={conversation} canManage={canManage} onChanged={invalidate} />
      )}

      {(canCreateLead || canViewLead) && (
        <div className="space-y-2 border-b bg-muted/20 p-2">
          {conversation.lead_id ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">Lead {lead?.human_reference || "..."}</Badge>
                {lead && <Badge variant="secondary" className="capitalize">{lead.status}</Badge>}
                {lead && lead.qualification_status !== "unqualified" && (
                  <Badge variant="secondary">{qualificationStatusLabel(lead.qualification_status)}</Badge>
                )}
                {leadStageName && <Badge variant="outline">{leadStageName}</Badge>}
                {ownerName && <Badge variant="outline">Owner: {ownerName}</Badge>}
                {latestOpportunity && (
                  <Badge variant="outline" className="capitalize">{opportunityLabel}: {latestOpportunity.status}</Badge>
                )}
                {lead?.status === "converted" && <Badge variant="secondary">Customer</Badge>}
              </div>

              {(learnedSummary || learnedIntake.length > 0) && (
                <div className="rounded-md border bg-background p-2 text-xs">
                  <p className="mb-1 font-medium text-muted-foreground">What we've learned</p>
                  {learnedSummary && <p className="whitespace-pre-wrap">{learnedSummary}</p>}
                  {learnedIntake.length > 0 && (
                    <dl className="mt-1 grid grid-cols-[minmax(0,8rem)_1fr] gap-x-2 gap-y-0.5">
                      {learnedIntake.map((r) => (
                        <div key={r.key} className="contents">
                          <dt className="truncate text-muted-foreground">{r.label}</dt>
                          <dd className="min-w-0 break-words">{r.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-1.5">
                {canViewLead && <Button size="sm" variant="ghost" className="h-7" onClick={() => goToLead(conversation.lead_id as string)}>Open lead</Button>}
                {latestOpportunity
                  ? canViewLead && <Button size="sm" variant="ghost" className="h-7" onClick={() => goToLead(conversation.lead_id as string, true)}>{openOpportunityActionLabel({ opportunity_label: opportunityLabel })}</Button>
                  : canCreateOpportunity && <Button size="sm" variant="outline" className="h-7" onClick={openOppDialog}><Briefcase className="mr-1.5 h-3.5 w-3.5" /> Create {opportunityLabel.toLowerCase()}</Button>}
              </div>
            </>
          ) : canCreateLead ? (
            leadDuplicates ? (
              <div className="w-full space-y-2 text-xs">
                <p className="font-medium">Possible existing lead</p>
                {leadDuplicates.map((d) => (
                  <div key={d.id} className="flex items-center justify-between rounded-md border bg-background p-2">
                    <span>{d.contact_name || d.phone || d.human_reference} ({d.human_reference})</span>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => goToLead(d.id)}>Open existing</Button>
                      <Button size="sm" variant="outline" className="h-7" disabled={creatingLead} onClick={() => handleLinkExisting(d.id)}>Link conversation</Button>
                    </div>
                  </div>
                ))}
                <label className="flex items-center gap-1.5 text-muted-foreground">
                  <input type="checkbox" checked={copyContextOnLink} onChange={(e) => setCopyContextOnLink(e.target.checked)} />
                  Also copy the AI summary &amp; any documents to that lead
                </label>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => setLeadDuplicates(null)}>Cancel</Button>
                  <Button size="sm" variant="outline" className="h-7" disabled={creatingLead} onClick={() => handleCreateLead(true)}>Create new anyway</Button>
                </div>
              </div>
            ) : (
              <Button size="sm" variant="outline" disabled={creatingLead} onClick={() => handleCreateLead(false)}><UserPlus className="mr-1.5 h-3.5 w-3.5" /> Create lead</Button>
            )
          ) : null}
        </div>
      )}

      {canManage && (
        <div className="border-b bg-muted/30 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            {conversation.ai_enabled ? <Bot className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
            {aiHumanStatusText(conversation)}
          </p>

          {intakeEval && (
            <div className="mb-2 rounded-md border bg-background p-2 text-xs">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium text-muted-foreground">What we've learned</span>
                <span className="text-muted-foreground">
                  {intakeEval.requiredCollected} of {intakeEval.requiredTotal} required details collected
                  {conversation.intake_completed_at && " · complete"}
                </span>
              </div>
              <ul className="space-y-0.5">
                {intakeEval.rows.map((r) => (
                  <li key={r.key} className="flex items-baseline gap-1.5">
                    <span aria-hidden className={
                      r.status === "collected" ? "text-emerald-600" : r.status === "needs_clarification" ? "text-amber-600" : "text-muted-foreground"
                    }>
                      {r.status === "collected" ? "✓" : r.status === "needs_clarification" ? "!" : "○"}
                    </span>
                    <span className="text-muted-foreground">{r.label}{r.required ? "" : " (optional)"}</span>
                    {editingKey === r.key ? (
                      <span className="flex min-w-0 flex-1 items-center gap-1">
                        <input
                          autoFocus
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleCorrectAnswer(r.key, editingValue); if (e.key === "Escape") setEditingKey(null); }}
                          className="min-w-0 flex-1 rounded border bg-background px-1 py-0.5 text-xs"
                        />
                        <button className="text-emerald-600" onClick={() => handleCorrectAnswer(r.key, editingValue)}>Save</button>
                        <button className="text-muted-foreground" onClick={() => setEditingKey(null)}>Cancel</button>
                      </span>
                    ) : (
                      <span className="min-w-0 flex-1 break-words">
                        {r.status === "collected"
                          ? (Array.isArray(r.value) ? r.value.join(", ") : String(r.value))
                          : r.status === "needs_clarification"
                            ? <span className="text-amber-600">Needs clarification</span>
                            : <span className="text-muted-foreground">Missing</span>}
                        <button
                          className="ml-1.5 text-muted-foreground underline underline-offset-2 hover:text-foreground"
                          onClick={() => { setEditingKey(r.key); setEditingValue(r.status === "collected" && !Array.isArray(r.value) ? String(r.value) : ""); }}
                        >
                          edit
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Select value={conversation.assigned_staff_id || ""} onValueChange={handleAssign} disabled={busy}>
              <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Assign to..." /></SelectTrigger>
              <SelectContent>
                {(members || []).map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.profile?.full_name || "Unnamed"}</SelectItem>)}
              </SelectContent>
            </Select>
            {conversation.ai_enabled ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => user && handleAssign(user.id)}>Take over</Button>
            ) : (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmReturnToAI(true)}>Return to AI</Button>
            )}
            {intakeSchema ? (
              <Button size="sm" variant="outline" disabled={askingInfo || !intakeEval?.nextField} onClick={handleAskNextQuestion}>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Ask next question
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={!conversation.intake_missing_fields?.length} onClick={handleAskMissingInfo}>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Ask missing info
              </Button>
            )}
            {conversation.inbox_status === "resolved" ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={handleReopen}>Reopen chat</Button>
            ) : (
              <Button size="sm" variant="outline" disabled={busy || conversation.ai_enabled} onClick={() => setConfirmResolve(true)}>
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Resolve
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {messagesLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : !messages?.length ? (
          <p className="text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
        <div ref={messagesEndRef} />
      </div>

      {notes && notes.length > 0 && (
        <div className="max-h-32 overflow-y-auto border-t bg-amber-50 p-3 dark:bg-amber-950/20">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Internal notes</p>
          {notes.map((n) => (
            <p key={n.id} className="text-xs"><span className="font-medium">{n.author_name}:</span> {n.body}</p>
          ))}
        </div>
      )}

      {canManage && (
        <div className="space-y-2 border-t p-3">
          {windowOpen ? (
            <div className="flex gap-2">
              <Textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Type a reply..." className="min-h-[60px]" maxLength={1000} />
              <Button onClick={handleSend} disabled={sending || !replyText.trim()} className="self-end"><Send className="h-4 w-4" /></Button>
            </div>
          ) : (
            <div className="space-y-2 rounded-md border border-dashed p-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5" />
                24-hour messaging window closed - a normal reply can't be sent until the customer messages again, or you send an approved template below.
              </p>
              {usableTemplates.length === 0 ? (
                <p className="text-xs text-muted-foreground">No approved templates are available for this workspace yet. Connect WhatsApp and sync templates under Integrations.</p>
              ) : (
                <>
                  <Select value={selectedTemplateId} onValueChange={handleSelectTemplate}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Choose an approved template..." /></SelectTrigger>
                    <SelectContent>
                      {usableTemplates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name} ({t.language})</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {selectedTemplate && templateParams.map((value, i) => (
                    <input
                      key={i}
                      value={value}
                      onChange={(e) => setTemplateParams(templateParams.map((p, j) => (j === i ? e.target.value : p)))}
                      placeholder={`Parameter ${i + 1}`}
                      className="w-full rounded-md border bg-background px-2 py-1 text-xs"
                    />
                  ))}
                  {selectedTemplate && (
                    <Button size="sm" onClick={handleSendTemplate} disabled={sendingTemplate || templateParams.some((p) => !p.trim())}>
                      <Send className="mr-1.5 h-3.5 w-3.5" /> Send template
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add an internal note (not sent to the customer)" className="flex-1 rounded-md border bg-background px-2 py-1 text-xs" onKeyDown={(e) => e.key === "Enter" && handleAddNote()} />
            <Button variant="ghost" size="sm" onClick={handleAddNote} disabled={!noteText.trim()}>Add note</Button>
          </div>
        </div>
      )}

      <AlertDialog open={confirmResolve} onOpenChange={setConfirmResolve}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark this conversation as resolved?</AlertDialogTitle>
            <AlertDialogDescription>AI will remain silent. You can reopen it later if the customer replies again.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResolve}>Resolve</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmReturnToAI} onOpenChange={setConfirmReturnToAI}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Return this chat to AI?</AlertDialogTitle>
            <AlertDialogDescription>{isAssignedToMe ? "You" : conversation.assigned_staff_name || "The assigned staff member"} will no longer control this conversation - AI replies will resume automatically.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReturnToAI}>Return to AI</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!askInfoPreview} onOpenChange={(open) => !open && setAskInfoPreview(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send this question to the customer?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p className="rounded-md border bg-muted/40 p-2 text-sm text-foreground">{askInfoPreview?.next_question}</p>
                <p>
                  It will be sent on WhatsApp{askInfoPreview?.field_label ? ` to collect “${askInfoPreview.field_label}”` : ""}. Nothing is sent until you confirm.
                  {askInfoPreview?.requires_template && " The 24-hour window is closed - use an approved template from the conversation instead."}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={askingInfo}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmAskInfo} disabled={askingInfo || askInfoPreview?.requires_template}>Send question</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {!canManage && (
        <div className="flex items-center gap-2 border-t p-3 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" /> You have view-only access to this inbox.
        </div>
      )}

      <Dialog open={oppDialogOpen} onOpenChange={setOppDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create {opportunityLabel.toLowerCase()} from this conversation</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Title</p>
              <Input value={oppTitle} onChange={(e) => setOppTitle(e.target.value)} placeholder={`${opportunityLabel} title`} className="h-8 text-sm" />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Pipeline</p>
              <Select value={oppPipelineId} onValueChange={(v) => { setOppPipelineId(v); setOppStageId(""); }}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Default pipeline" /></SelectTrigger>
                <SelectContent>{(pipelines || []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Stage</p>
              <Select value={oppStageId} onValueChange={setOppStageId}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="First stage" /></SelectTrigger>
                <SelectContent>{(oppStages || []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Owner (optional)</p>
              <Select value={oppOwnerId} onValueChange={setOppOwnerId}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>{(members || []).map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.profile?.full_name || "Unnamed"}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Estimated value (optional)</p>
              <Input value={oppValue} onChange={(e) => setOppValue(e.target.value)} inputMode="decimal" placeholder="0.00" className="h-8 text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOppDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateOpportunity} disabled={creatingOpp || !oppTitle.trim()}>Create {opportunityLabel.toLowerCase()}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Phase 4: conversation <-> customer -----------------------------------
function ConversationCustomerPanel({ workspaceId, conversation, canManage, onChanged }: {
  workspaceId: string;
  conversation: InboxConversationRow;
  canManage: boolean;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const { data: customer } = useCustomer(conversation.customer_id);
  const { data: candidates } = useCustomerMatchCandidates(workspaceId, conversation.id, !conversation.customer_id);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const { data: searchResults } = useCustomersSearch(picking ? workspaceId : null, q);

  const doLink = async (customerId: string, change = false) => {
    setBusy(true);
    try {
      await linkConversationCustomer(workspaceId, conversation.id, customerId, change);
      setPicking(false); setQ("");
      onChanged();
      toast.success("Customer linked");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to link customer");
    } finally { setBusy(false); }
  };
  const doUnlink = async () => {
    setBusy(true);
    try {
      await unlinkConversationCustomer(workspaceId, conversation.id);
      onChanged();
      toast.success("Customer unlinked");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to unlink customer");
    } finally { setBusy(false); }
  };

  if (conversation.customer_id) {
    return (
      <div className="space-y-1.5 border-b bg-muted/20 p-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">Customer</Badge>
          <span className="font-medium">{customer?.name || "..."}</span>
          {customer && <span className="text-muted-foreground">since {new Date(customer.customer_since).toLocaleDateString()}</span>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" className="h-7" onClick={() => navigate(`/app/customers/${conversation.customer_id}`)}>Open Customer 360</Button>
          {canManage && <Button size="sm" variant="ghost" className="h-7" onClick={() => setPicking((v) => !v)}>Change</Button>}
          {canManage && <Button size="sm" variant="ghost" className="h-7 text-destructive" disabled={busy} onClick={doUnlink}>Unlink</Button>}
        </div>
        {picking && (
          <div className="space-y-1 rounded-md border bg-background p-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers..." className="w-full rounded border bg-background px-2 py-1 text-xs" />
            {(searchResults || []).slice(0, 6).map((c) => (
              <button key={c.id} disabled={busy} className="flex w-full items-center justify-between rounded px-1.5 py-1 text-left hover:bg-muted" onClick={() => doLink(c.id, true)}>
                <span>{c.name}</span><span className="text-muted-foreground">{c.phone || c.email || ""}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const exact = (candidates || []).filter((c) => c.match_tier === "exact");
  const possible = (candidates || []).filter((c) => c.match_tier === "possible");

  return (
    <div className="space-y-1.5 border-b bg-muted/20 p-2 text-xs">
      {exact.length > 0 && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-2 dark:border-emerald-900 dark:bg-emerald-950/30">
          <p className="font-medium">Existing customer found</p>
          {exact.map((c) => (
            <div key={c.customer_id} className="mt-1 flex items-center justify-between gap-2">
              <span>{c.name} <span className="text-muted-foreground">- {c.match_reason}</span></span>
              {canManage && <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => doLink(c.customer_id)}>Link</Button>}
            </div>
          ))}
        </div>
      )}
      {possible.length > 0 && (
        <div className="rounded-md border p-2">
          <p className="font-medium text-muted-foreground">Possible match{possible.length > 1 ? "es" : ""}</p>
          {possible.map((c) => (
            <div key={c.customer_id} className="mt-1 flex items-center justify-between gap-2">
              <span>{c.name} <span className="text-muted-foreground">- {c.match_reason}</span></span>
              {canManage && <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => doLink(c.customer_id)}>Link anyway</Button>}
            </div>
          ))}
        </div>
      )}
      {canManage && (
        <div>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setPicking((v) => !v)}>Link customer</Button>
          {picking && (
            <div className="mt-1 space-y-1 rounded-md border bg-background p-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers..." className="w-full rounded border bg-background px-2 py-1 text-xs" />
              {(searchResults || []).slice(0, 6).map((c) => (
                <button key={c.id} disabled={busy} className="flex w-full items-center justify-between rounded px-1.5 py-1 text-left hover:bg-muted" onClick={() => doLink(c.id)}>
                  <span>{c.name}</span><span className="text-muted-foreground">{c.phone || c.email || ""}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

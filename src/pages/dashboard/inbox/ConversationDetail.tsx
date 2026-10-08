import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, ArrowLeft, Bot, Briefcase, CheckCircle2, Clock, MessageCircle, PanelRight, Paperclip, Send, Sparkles, UserCheck, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { useMediaQuery } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { getInboxMediaUrl, useInboxInternalNotes, useInboxMessages, type InboxMessageRow } from "@/hooks/useInboxMessages";
import type { InboxConversationRow } from "@/hooks/useInboxConversations";
import { useLead, usePipelines, usePipelineStages } from "@/hooks/useLeads";
import { useOpportunitiesForLead, useCustomer } from "@/hooks/useOpportunities";
import { useCustomerMatchCandidates, useCustomersSearch } from "@/hooks/useCustomers";
import { linkConversationCustomer, unlinkConversationCustomer } from "@/lib/customer";
import { useWorkspaceSlaSettings } from "@/hooks/useWorkspaceSlaSettings";
import { computeSlaState } from "@/lib/slaState";
import { aiMediaBadge } from "@/lib/multimodalMedia";
import { addInternalNote, assignConversation, markConversationRead, pauseConversationAI, replyToConversation, replyWithTemplate, reopenConversation, resolveConversation, retryOutboundMessage, retryTranscription, returnConversationToAI, takeOverConversation } from "@/lib/inbox";
import { HandoverBadge } from "@/components/whatsapp/HandoverBadge";
import { AgentAssistMenu } from "@/components/whatsapp/AgentAssistMenu";
import { useConversationTimeline } from "@/hooks/useConversationTimeline";
import { handoverState } from "@/lib/handoverState";
import { canRetryOutbound, outboundDeliveryLabel, outboundDeliveryState } from "@/lib/outboundRetry";
import { canRetryTranscription, isAudioMessage, transcriptionHint, type TranscriptionStatus } from "@/lib/voiceTranscription";
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

function MessageBubble({ message, canManage, onRetry, retrying, onRetryTranscription, transcribing }: {
  message: InboxMessageRow;
  canManage: boolean;
  onRetry: (messageId: string) => void;
  retrying: boolean;
  onRetryTranscription: (messageId: string) => void;
  transcribing: boolean;
}) {
  const isInbound = message.direction === "inbound";
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  // Phase 9: while a retry is pending the row still carries
  // delivery_status = "failed"; outboundDeliveryState folds next_retry_at /
  // dead_lettered_at into an honest label. Fall back to the legacy
  // presentation for blocked_* / other statuses it doesn't own.
  const retryState = outboundDeliveryState(message);
  const showRetryLabel = !isInbound && retryState !== "not_applicable";
  const canRetry = canRetryOutbound(message, canManage);
  // Phase 10: a customer voice note. The original audio is authoritative;
  // the transcript (if any) is derived, possibly-inexact data shown as a
  // clearly-labelled, secondary block - never as the customer's words.
  const isAudio = isAudioMessage(message.media_mime_type);
  const transcriptionStatus = message.transcription_status as TranscriptionStatus | null;
  const transHint = isAudio && isInbound ? transcriptionHint(transcriptionStatus) : null;
  const canRetryTrans = isInbound && isAudio && canRetryTranscription(transcriptionStatus, canManage);

  useEffect(() => {
    if (message.media_storage_path) getInboxMediaUrl(message.media_storage_path).then(setMediaUrl);
  }, [message.media_storage_path]);

  const senderLabel = isInbound ? null : message.sender_type === "ai" ? "AI" : message.sender_type === "system" ? "System" : message.staff_sender_name || "Staff";
  // Customer (left, white) / staff (right, brand blue) / AI (right, teal
  // tint) / system (right, neutral). Failed delivery adds a red ring.
  const tone = isInbound ? "in" : message.sender_type === "ai" ? "ai" : message.sender_type === "system" ? "system" : "staff";
  const failed = !isInbound && (retryState === "delivery_failed" || deliveryTone(message.delivery_status) === "error");
  const bubbleClass = {
    in: "border border-border bg-card text-foreground",
    ai: "bg-brand-soft text-foreground",
    system: "bg-muted text-foreground",
    staff: "bg-primary text-primary-foreground",
  }[tone];
  const subtle = tone === "staff" ? "text-primary-foreground/80" : "text-muted-foreground";
  const errorText = tone === "staff" ? "font-medium text-white" : "font-medium text-destructive-strong";
  const time = new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className={`flex ${isInbound ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm sm:max-w-[75%] ${isInbound ? "rounded-bl-md" : "rounded-br-md"} ${bubbleClass} ${failed ? "ring-2 ring-destructive ring-offset-1 ring-offset-background" : ""}`}>
        <p className={`mb-0.5 text-xs ${subtle}`}>
          {senderLabel ?? "Customer"} · <time dateTime={message.created_at}>{time}</time>
        </p>
        {message.media_storage_path && (
          <div className="mb-1">
            {mediaUrl ? (
              message.media_mime_type?.startsWith("image/") ? (
                <img src={mediaUrl} alt={message.media_filename || "attachment"} className="max-h-48 rounded" />
              ) : isAudio ? (
                <span className="block">
                  <span className="mb-0.5 block text-xs text-muted-foreground">{message.message_type === "voice" ? "Voice note" : "Audio message"}</span>
                  <audio controls preload="metadata" src={mediaUrl} className="max-w-full" />
                </span>
              ) : (
                <a href={mediaUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 underline"><Paperclip className="h-3 w-3" /> {message.media_filename || "Attachment"}</a>
              )
            ) : (
              <p className="flex items-center gap-1 text-xs opacity-70"><Paperclip className="h-3 w-3" /> Loading {isAudio ? "voice note" : "attachment"}...</p>
            )}
            {isInbound && aiMediaBadge(message.ai_media_status) && (
              <span
                className={`mt-1 inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                  aiMediaBadge(message.ai_media_status)!.tone === "ok"
                    ? "bg-success-soft text-success"
                    : aiMediaBadge(message.ai_media_status)!.tone === "warn"
                    ? "bg-warning-soft text-warning"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {aiMediaBadge(message.ai_media_status)!.label}
              </span>
            )}
          </div>
        )}
        {!(isAudio && isInbound) && <p className="whitespace-pre-wrap">{message.content}</p>}
        {isAudio && isInbound && (
          <>
            {message.transcript && (
              <div className="mt-1 rounded border-l-2 border-input bg-muted/60 px-2 py-1">
                <p className="text-overline uppercase text-muted-foreground">Transcript</p>
                <p className="whitespace-pre-wrap text-sm">{message.transcript}</p>
              </div>
            )}
            {transHint && (
              <p
                className={`mt-1 text-[11px] ${
                  transHint.tone === "warn" ? "text-warning" : "text-muted-foreground"
                }`}
              >
                {transHint.label}
                {canRetryTrans && (
                  <button
                    type="button"
                    onClick={() => onRetryTranscription(message.id)}
                    disabled={transcribing}
                    className="ml-2 font-medium underline underline-offset-2 disabled:opacity-50"
                  >
                    {transcribing ? "Retrying..." : "Retry transcription"}
                  </button>
                )}
              </p>
            )}
          </>
        )}
        {showRetryLabel ? (
          <div className="mt-1 flex items-center gap-2">
            <span className={`text-xs ${retryState === "delivery_failed" ? errorText : subtle}`}>
              {outboundDeliveryLabel(message)}
              {message.dead_lettered_at && message.dead_letter_reason ? ` · ${message.dead_letter_reason.replace(/_/g, " ")}` : ""}
            </span>
            {canRetry && (
              <button
                type="button"
                onClick={() => onRetry(message.id)}
                disabled={retrying}
                className={`text-xs font-medium underline underline-offset-2 disabled:opacity-50 ${tone === "staff" ? "text-white" : "text-link"}`}
              >
                {retrying ? "Retrying..." : "Retry"}
              </button>
            )}
          </div>
        ) : (
          !isInbound && message.delivery_status && (
            <p className={`mt-1 text-xs ${deliveryTone(message.delivery_status) === "error" ? errorText : subtle}`}>{deliveryLabel(message.delivery_status)}</p>
          )
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
  const { data: timeline } = useConversationTimeline(workspaceId, conversation.id, conversation.lead_id);
  const handover = handoverState(conversation);
  const { data: members } = useWorkspaceMembers(workspaceId);
  const { data: lead } = useLead(conversation.lead_id);
  const { data: leadOpportunities } = useOpportunitiesForLead(conversation.lead_id);
  const { data: templates } = useInboxTemplates(workspaceId);
  const opportunityLabel = useOpportunityTerminology(workspaceId);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const role = currentMembership?.role;
  const { data: slaSettings } = useWorkspaceSlaSettings(workspaceId);
  const slaState = useMemo(() => computeSlaState(conversation, slaSettings), [conversation, slaSettings]);
  // Phase 7: an honest "why" for an AI-limit pause - distinct from a normal
  // handoff or a provider error. Present only while the cap alert is open.
  const { data: aiLimitPaused } = useQuery({
    queryKey: ["conversation-ai-limit-alert", conversation.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("inbox_alerts")
        .select("id")
        .eq("conversation_id", conversation.id)
        .eq("alert_type", "ai_usage_limit_reached")
        .eq("is_resolved", false)
        .limit(1);
      return (data ?? []).length > 0;
    },
    enabled: !conversation.ai_enabled,
  });
  const aiStatusText = aiLimitPaused
    ? "AI paused - this workspace has reached its monthly Inbox AI usage limit. New customer messages are handed to staff. Use “Return to AI” once the limit is raised or the month resets."
    : aiHumanStatusText(conversation);
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
  const [composerMode, setComposerMode] = useState<"reply" | "note">("reply");
  const isWide = useMediaQuery("(min-width: 1280px)");
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [detailsSheetOpen, setDetailsSheetOpen] = useState(false);
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
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(null);
  const [transcribingMessageId, setTranscribingMessageId] = useState<string | null>(null);
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

  const handleTakeOver = async () => {
    setBusy(true);
    try {
      await takeOverConversation(workspaceId, conversation.id);
      invalidate();
      toast.success("You now own this conversation. AI will not reply automatically.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to take over this conversation");
    } finally {
      setBusy(false);
    }
  };

  const handlePauseAI = async () => {
    setBusy(true);
    try {
      await pauseConversationAI(workspaceId, conversation.id);
      invalidate();
      toast.success("AI paused on this conversation");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to pause AI");
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

  // Phase 9: manual retry of a dead-lettered outbound message. The edge
  // function re-runs every send safety gate against current state and
  // refuses if the message was actually delivered - this only reports the
  // outcome and refreshes the thread.
  const handleRetryMessage = async (messageId: string) => {
    setRetryingMessageId(messageId);
    try {
      const result = await retryOutboundMessage(workspaceId, conversation.id, messageId);
      invalidate();
      const outcome = result.outcome?.result;
      if (outcome === "succeeded") toast.success("Message re-sent");
      else if (outcome === "retry_scheduled") toast.success("Retry scheduled");
      else if (outcome === "dead_lettered") toast.error("Still could not be delivered - left for review");
      else if (outcome === "already_accepted") toast.info("This message was already delivered");
      else toast.success("Retry requested");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to retry this message");
    } finally {
      setRetryingMessageId(null);
    }
  };

  // Phase 10: manually re-run transcription for a customer voice note that
  // failed or was skipped for cost. Same message row + stored audio.
  const handleRetryTranscription = async (messageId: string) => {
    setTranscribingMessageId(messageId);
    try {
      const result = await retryTranscription(workspaceId, conversation.id, messageId);
      invalidate();
      if (result.status === "processed") toast.success("Voice note transcribed");
      else if (result.status === "failed") toast.error("Still couldn't transcribe this voice note");
      else if (result.status === "skipped_quota") toast.error("Over the monthly Inbox AI usage limit");
      else toast.info("Transcription attempted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to retry transcription");
    } finally {
      setTranscribingMessageId(null);
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

  const timelineItems = [
    ...(messages ?? []).map((m) => ({ kind: "message" as const, at: m.created_at, m })),
    ...(timeline ?? []).map((e) => ({ kind: "event" as const, at: e.at, e })),
    ...(notes ?? []).map((n) => ({ kind: "note" as const, at: n.created_at, n })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const openDetails = () => (isWide ? setDetailsOpen((v) => !v) : setDetailsSheetOpen(true));
  const detailsLabel = isWide && detailsOpen ? "Hide details" : "Details";

  // Secondary context lives in the details panel (xl) / drawer (smaller), so
  // the conversation itself stays the focus.
  const sectionClass = "space-y-2 border-b border-border px-4 py-3.5";
  const sectionTitle = (title: string, action?: ReactNode) => (
    <div className="flex items-center gap-2">
      <h4 className="flex-1 text-overline uppercase text-muted-foreground">{title}</h4>
      {action}
    </div>
  );
  const detailsContent = (
    <div className="text-sm">
      <section className={sectionClass} aria-label="Contact">
        {sectionTitle("Contact")}
        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5">
          <dt className="text-muted-foreground">WhatsApp</dt><dd className="min-w-0 break-words text-foreground">{conversation.phone_number}</dd>
          <dt className="text-muted-foreground">Status</dt><dd className="text-foreground">{inboxStatusLabel(conversation.inbox_status)}</dd>
          <dt className="text-muted-foreground">Priority</dt><dd className="text-foreground">{priorityLabel(conversation.priority_level)}</dd>
          <dt className="text-muted-foreground">Assigned</dt><dd className="text-foreground">{conversation.assigned_staff_name || "Unassigned"}</dd>
        </dl>
      </section>

      <section className={sectionClass} aria-label="Source">
        {sectionTitle("Source")}
        <AttributionSourceSummary workspaceId={workspaceId} targetType="conversation" targetId={conversation.id} compact fallbackLabel="Direct WhatsApp - no ad referral." />
      </section>

      {roleHasPermission(role, "opportunity.view") && (
        <section className={sectionClass} aria-label="Customer">
          {sectionTitle("Customer")}
          <ConversationCustomerPanel workspaceId={workspaceId} conversation={conversation} canManage={canManage} onChanged={invalidate} />
        </section>
      )}

      {(canCreateLead || canViewLead) && (
        <section className={sectionClass} aria-label="Lead">
          {sectionTitle("Lead")}
          {conversation.lead_id ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusPill tone="info" dot={false}>Lead {lead?.human_reference || "..."}</StatusPill>
                {lead && <StatusPill tone="neutral" dot={false} className="capitalize">{lead.status}</StatusPill>}
                {lead && lead.qualification_status !== "unqualified" && (
                  <StatusPill tone="success" dot={false}>{qualificationStatusLabel(lead.qualification_status)}</StatusPill>
                )}
                {leadStageName && <StatusPill tone="neutral" dot={false}>{leadStageName}</StatusPill>}
                {ownerName && <StatusPill tone="neutral" dot={false}>Owner: {ownerName}</StatusPill>}
                {latestOpportunity && (
                  <StatusPill tone="neutral" dot={false} className="capitalize">{opportunityLabel}: {latestOpportunity.status}</StatusPill>
                )}
                {lead?.status === "converted" && <StatusPill tone="success" dot={false}>Customer</StatusPill>}
              </div>

              {(learnedSummary || learnedIntake.length > 0) && (
                <div className="rounded-lg bg-muted/60 p-2.5 text-xs">
                  <p className="mb-1 font-medium text-muted-foreground">What we've learned</p>
                  {learnedSummary && <p className="whitespace-pre-wrap text-foreground">{learnedSummary}</p>}
                  {learnedIntake.length > 0 && (
                    <dl className="mt-1 grid grid-cols-[minmax(0,7rem)_1fr] gap-x-2 gap-y-0.5">
                      {learnedIntake.map((r) => (
                        <div key={r.key} className="contents">
                          <dt className="truncate text-muted-foreground">{r.label}</dt>
                          <dd className="min-w-0 break-words text-foreground">{r.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-1.5">
                {canViewLead && <Button size="sm" variant="outline" onClick={() => goToLead(conversation.lead_id as string)}>Open lead</Button>}
                {latestOpportunity
                  ? canViewLead && <Button size="sm" variant="ghost" onClick={() => goToLead(conversation.lead_id as string, true)}>{openOpportunityActionLabel({ opportunity_label: opportunityLabel })}</Button>
                  : canCreateOpportunity && <Button size="sm" variant="ghost" onClick={openOppDialog}><Briefcase aria-hidden="true" /> Create {opportunityLabel.toLowerCase()}</Button>}
              </div>
            </>
          ) : canCreateLead ? (
            leadDuplicates ? (
              <div className="w-full space-y-2 text-xs">
                <p className="font-medium text-foreground">Possible existing lead</p>
                {leadDuplicates.map((d) => (
                  <div key={d.id} className="space-y-1.5 rounded-lg border border-border p-2">
                    <span className="block text-foreground">{d.contact_name || d.phone || d.human_reference} ({d.human_reference})</span>
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => goToLead(d.id)}>Open existing</Button>
                      <Button size="sm" variant="outline" disabled={creatingLead} onClick={() => handleLinkExisting(d.id)}>Link conversation</Button>
                    </div>
                  </div>
                ))}
                <label className="flex items-center gap-1.5 text-muted-foreground">
                  <input type="checkbox" checked={copyContextOnLink} onChange={(e) => setCopyContextOnLink(e.target.checked)} />
                  Also copy the AI summary &amp; any documents to that lead
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setLeadDuplicates(null)}>Cancel</Button>
                  <Button size="sm" variant="outline" disabled={creatingLead} onClick={() => handleCreateLead(true)}>Create new anyway</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">This conversation isn't linked to a lead yet.</p>
                <Button size="sm" variant="outline" disabled={creatingLead} onClick={() => handleCreateLead(false)}><UserPlus aria-hidden="true" /> Create lead</Button>
              </div>
            )
          ) : (
            <p className="text-xs text-muted-foreground">Not linked to a lead.</p>
          )}
        </section>
      )}

      {canManage && (
        <section className={sectionClass} aria-label="Intake">
          {sectionTitle(
            "What we've learned",
            intakeSchema ? (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-link" disabled={askingInfo || !intakeEval?.nextField} onClick={handleAskNextQuestion}>
                <Sparkles aria-hidden="true" /> Ask next question
              </Button>
            ) : (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-link" disabled={!conversation.intake_missing_fields?.length} onClick={handleAskMissingInfo}>
                <Sparkles aria-hidden="true" /> Ask missing info
              </Button>
            ),
          )}
          {intakeEval ? (
            <>
              <p className="text-xs text-muted-foreground">
                {intakeEval.requiredCollected} of {intakeEval.requiredTotal} required details collected
                {conversation.intake_completed_at && " · complete"}
              </p>
              <ul className="space-y-1 text-xs">
                {intakeEval.rows.map((r) => (
                  <li key={r.key} className="flex items-baseline gap-1.5">
                    <span aria-hidden className={
                      r.status === "collected" ? "text-success" : r.status === "needs_clarification" ? "text-warning" : "text-muted-foreground"
                    }>
                      {r.status === "collected" ? "✓" : r.status === "needs_clarification" ? "!" : "○"}
                    </span>
                    <span className="shrink-0 text-muted-foreground">{r.label}{r.required ? "" : " (optional)"}</span>
                    {editingKey === r.key ? (
                      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                        <input
                          autoFocus
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleCorrectAnswer(r.key, editingValue); if (e.key === "Escape") setEditingKey(null); }}
                          aria-label={`Correct ${r.label}`}
                          className="min-w-0 flex-1 rounded-md border border-input bg-card px-1.5 py-1 text-xs"
                        />
                        <button className="font-medium text-link" onClick={() => handleCorrectAnswer(r.key, editingValue)}>Save</button>
                        <button className="text-muted-foreground" onClick={() => setEditingKey(null)}>Cancel</button>
                      </span>
                    ) : (
                      <span className="min-w-0 flex-1 break-words text-foreground">
                        {r.status === "collected"
                          ? (Array.isArray(r.value) ? r.value.join(", ") : String(r.value))
                          : r.status === "needs_clarification"
                            ? <span className="text-warning">Needs clarification</span>
                            : <span className="text-muted-foreground">Missing</span>}
                        <button
                          className="ml-1.5 text-muted-foreground underline underline-offset-2 hover:text-foreground"
                          aria-label={`Edit ${r.label}`}
                          onClick={() => { setEditingKey(r.key); setEditingValue(r.status === "collected" && !Array.isArray(r.value) ? String(r.value) : ""); }}
                        >
                          edit
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {conversation.intake_missing_fields?.length
                ? `Still needed: ${conversation.intake_missing_fields.join(", ")}.`
                : "No intake form applies to this conversation."}
            </p>
          )}
        </section>
      )}
    </div>
  );

  return (
    <div className="flex h-full min-w-0">
      <section aria-label={`Conversation with ${conversation.display_name || conversation.phone_number}`} className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-start gap-2 border-b border-border px-2 py-2 sm:gap-3 sm:px-4 sm:py-2.5">
        {onBack && <Button variant="ghost" size="icon" className="shrink-0 lg:hidden" onClick={onBack} aria-label="Back to conversations"><ArrowLeft aria-hidden="true" /></Button>}
        <span className="mt-0.5 hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-selected text-xs font-semibold text-selected-foreground sm:flex" aria-hidden="true">
          {(conversation.display_name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || <MessageCircle className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-title-card text-foreground">{conversation.display_name || conversation.phone_number}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {conversation.display_name && <span className="mr-1 hidden text-xs text-muted-foreground sm:inline">{conversation.phone_number}</span>}
            <HandoverBadge conversation={conversation} assigneeName={conversation.assigned_staff_name} />
            {conversation.inbox_status === "waiting_client" && <StatusPill tone="neutral">{inboxStatusLabel(conversation.inbox_status)}</StatusPill>}
            {conversation.priority_level !== "normal" && <StatusPill tone={conversation.priority_level === "urgent" ? "danger" : "warning"}>{priorityLabel(conversation.priority_level)}</StatusPill>}
            <StatusPill tone={windowState === "open" ? "success" : windowState === "closed" ? "neutral" : "warning"}>{messagingWindowLabel(windowState)}</StatusPill>
            {slaState.applicable && (
              <StatusPill tone={slaState.phase === "overdue" ? "danger" : slaState.phase === "due_soon" ? "warning" : "neutral"}>
                {slaState.phase === "overdue"
                  ? `Overdue by ${slaState.minutesOverdue} min`
                  : slaState.phase === "due_soon"
                    ? `Human response due in ${slaState.minutesRemaining} min`
                    : `Waiting for staff · due in ${slaState.minutesRemaining} min`}
                {conversation.assigned_staff_name ? ` · ${conversation.assigned_staff_name}` : ""}
              </StatusPill>
            )}
          </div>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={openDetails} aria-expanded={isWide ? detailsOpen : detailsSheetOpen} aria-label={detailsLabel}>
          <PanelRight aria-hidden="true" /><span className="hidden sm:inline">{detailsLabel}</span>
        </Button>
      </header>

      {canManage && (
        <div className="space-y-2 border-b border-border bg-background/60 px-2 py-2 sm:px-4">
          <p className="flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground" title={aiStatusText}>
            {conversation.ai_enabled ? <Bot className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <UserCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            <span className="line-clamp-2 min-w-0 sm:line-clamp-none">{aiStatusText}</span>
          </p>
          {/* One row of actions; scrolls sideways on narrow screens rather
              than stacking over the chat. */}
          <div className="-mx-2 flex items-center gap-2 overflow-x-auto px-2 pb-0.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          <Select value={conversation.assigned_staff_id || ""} onValueChange={handleAssign} disabled={busy}>
            <SelectTrigger className="h-[var(--control-h-sm)] w-40 shrink-0 text-xs" aria-label="Assign conversation"><SelectValue placeholder="Assign to..." /></SelectTrigger>
            <SelectContent>
              {(members || []).map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.profile?.full_name || "Unnamed"}</SelectItem>)}
            </SelectContent>
          </Select>
          {handover !== "closed" && !(handover === "human_active" && conversation.assigned_staff_id === user?.id) && (
            <Button size="sm" variant={handover === "handover_requested" ? "default" : "outline"} disabled={busy} onClick={handleTakeOver}>Take over</Button>
          )}
          {handover === "bot_active" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={handlePauseAI}>Pause AI</Button>
          )}
          {handover !== "bot_active" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmReturnToAI(true)}>Return to automation</Button>
          )}
          {conversation.inbox_status === "resolved" ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={handleReopen}>Reopen chat</Button>
          ) : (
            <Button size="sm" variant="outline" disabled={busy || conversation.ai_enabled} onClick={() => setConfirmResolve(true)}>
              <CheckCircle2 aria-hidden="true" /> Resolve
            </Button>
          )}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto bg-background/60 px-3 py-4 sm:px-5" role="log" aria-label="Messages" aria-live="polite">
        {messagesLoading ? (
          <div className="space-y-3" role="status" aria-label="Loading messages">
            <div className="h-12 w-2/3 animate-pulse rounded-2xl bg-muted" />
            <div className="ml-auto h-12 w-1/2 animate-pulse rounded-2xl bg-muted" />
          </div>
        ) : !messages?.length && !notes?.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          timelineItems.map((item) =>
            item.kind === "event" ? (
              <div key={`ev-${item.e.id}`} className="flex justify-center" role="note">
                <span className={`rounded-full px-2.5 py-0.5 text-xs ${item.e.tone === "handover" ? "bg-warning-soft text-warning" : item.e.tone === "crm" ? "bg-info-soft text-info" : "bg-muted text-muted-foreground"}`}>
                  {item.e.text} · {new Date(item.e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ) : item.kind === "note" ? (
              <div key={`note-${item.n.id}`} role="note" aria-label="Internal note" className="mx-auto max-w-[min(36rem,100%)] rounded-xl border border-dashed border-warning-solid/70 bg-warning-soft px-3 py-2">
                <p className="text-xs font-medium text-warning">
                  Internal note · {item.n.author_name} · {new Date(item.n.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · not sent to the customer
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{item.n.body}</p>
              </div>
            ) : (
              <MessageBubble
                key={item.m.id}
                message={item.m}
                canManage={canManage}
                onRetry={handleRetryMessage}
                retrying={retryingMessageId === item.m.id}
                onRetryTranscription={handleRetryTranscription}
                transcribing={transcribingMessageId === item.m.id}
              />
            ),
          )
        )}
        <div ref={messagesEndRef} />
      </div>

      {canManage ? (
        <div className="space-y-2 border-t border-border bg-card px-2 py-2.5 sm:px-4 sm:py-3">
          <div role="tablist" aria-label="Composer mode" className="flex gap-4 text-sm">
            {(["reply", "note"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={composerMode === mode}
                onClick={() => setComposerMode(mode)}
                className={`-mb-px border-b-2 pb-1 font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${composerMode === mode ? (mode === "note" ? "border-warning-solid text-foreground" : "border-primary text-foreground") : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {mode === "reply" ? "Reply" : "Internal note"}
              </button>
            ))}
          </div>

          {composerMode === "note" ? (
            <div className="space-y-2">
              <div className="flex items-end gap-2 rounded-xl border border-dashed border-warning-solid/70 bg-warning-soft p-2">
                <Textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Add an internal note (not sent to the customer)"
                  aria-label="Internal note"
                  className="min-h-[44px] flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddNote(); } }}
                />
                <Button size="sm" variant="outline" onClick={handleAddNote} disabled={!noteText.trim()}>Add note</Button>
              </div>
              <p className="text-xs text-muted-foreground">Only your team can see notes.</p>
            </div>
          ) : windowOpen ? (
            <>
              <div className="flex items-end gap-2 rounded-xl border border-input bg-card p-2 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/20">
                <Textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Write a reply on WhatsApp…"
                  aria-label="Reply"
                  className="min-h-[44px] flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
                  maxLength={1000}
                />
                <Button onClick={handleSend} disabled={sending || !replyText.trim()} aria-label="Send reply"><Send aria-hidden="true" /><span className="hidden sm:inline">Send</span></Button>
              </div>
              <AgentAssistMenu workspaceId={workspaceId} conversationId={conversation.id} draft={replyText} onDraft={(t) => setReplyText(t.slice(0, 1000))} disabled={sending} />
            </>
          ) : (
            <div className="space-y-2">
              <div className="rounded-xl bg-muted p-3" role="status">
                <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> The 24-hour reply window has closed
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  24-hour messaging window closed - a normal reply can't be sent until the customer messages again, or you send an approved template below.
                </p>
              </div>
              {usableTemplates.length === 0 ? (
                <p className="text-xs text-muted-foreground">No approved templates are available for this workspace yet. Connect WhatsApp and sync templates under Integrations.</p>
              ) : (
                <>
                  <Select value={selectedTemplateId} onValueChange={handleSelectTemplate}>
                    <SelectTrigger aria-label="Approved template"><SelectValue placeholder="Choose an approved template..." /></SelectTrigger>
                    <SelectContent>
                      {usableTemplates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name} ({t.language})</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {selectedTemplate && templateParams.map((value, i) => (
                    <Input
                      key={i}
                      value={value}
                      onChange={(e) => setTemplateParams(templateParams.map((p, j) => (j === i ? e.target.value : p)))}
                      placeholder={`Parameter ${i + 1}`}
                      aria-label={`Template parameter ${i + 1}`}
                    />
                  ))}
                  {selectedTemplate && (
                    <Button className="w-full sm:w-auto" onClick={handleSendTemplate} disabled={sendingTemplate || templateParams.some((p) => !p.trim())}>
                      <Send aria-hidden="true" /> Send template
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> You have view-only access to this inbox.
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
      </section>

      {isWide ? (
        detailsOpen && (
          <aside aria-label="Conversation details" className="hidden w-[19rem] shrink-0 flex-col overflow-hidden border-l border-border bg-card xl:flex">
            <div className="flex min-h-12 items-center gap-2 border-b border-border px-4 py-2">
              <h3 className="flex-1 text-title-card text-foreground">Details</h3>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => setDetailsOpen(false)} aria-label="Close details"><X aria-hidden="true" /></Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{detailsContent}</div>
          </aside>
        )
      ) : (
        <Sheet open={detailsSheetOpen} onOpenChange={setDetailsSheetOpen}>
          <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-sm">
            <SheetHeader className="border-b border-border px-4 py-3 text-left">
              <SheetTitle className="text-title-card">Details</SheetTitle>
              <SheetDescription className="text-xs">{conversation.display_name || conversation.phone_number}</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto">{detailsContent}</div>
          </SheetContent>
        </Sheet>
      )}
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
      <div className="space-y-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill tone="success" dot={false}>Customer</StatusPill>
          <span className="text-sm font-medium text-foreground">{customer?.name || "..."}</span>
          {customer && <span className="text-muted-foreground">since {new Date(customer.customer_since).toLocaleDateString()}</span>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => navigate(`/app/customers/${conversation.customer_id}`)}>Open Customer 360</Button>
          {canManage && <Button size="sm" variant="ghost" onClick={() => setPicking((v) => !v)}>Change</Button>}
          {canManage && <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={doUnlink}>Unlink</Button>}
        </div>
        {picking && (
          <div className="space-y-1 rounded-lg border border-border p-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers..." aria-label="Search customers" className="h-[var(--control-h-sm)] text-xs" />
            {(searchResults || []).slice(0, 6).map((c) => (
              <button key={c.id} disabled={busy} className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1.5 text-left hover:bg-accent" onClick={() => doLink(c.id, true)}>
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
    <div className="space-y-2 text-xs">
      {exact.length === 0 && possible.length === 0 && <p className="text-muted-foreground">Not linked to a customer.</p>}
      {exact.length > 0 && (
        <div className="rounded-lg bg-success-soft p-2">
          <p className="font-medium text-success">Existing customer found</p>
          {exact.map((c) => (
            <div key={c.customer_id} className="mt-1 flex items-center justify-between gap-2">
              <span>{c.name} <span className="text-muted-foreground">- {c.match_reason}</span></span>
              {canManage && <Button size="sm" variant="outline" disabled={busy} onClick={() => doLink(c.customer_id)}>Link</Button>}
            </div>
          ))}
        </div>
      )}
      {possible.length > 0 && (
        <div className="rounded-lg border border-border p-2">
          <p className="font-medium text-muted-foreground">Possible match{possible.length > 1 ? "es" : ""}</p>
          {possible.map((c) => (
            <div key={c.customer_id} className="mt-1 flex items-center justify-between gap-2">
              <span>{c.name} <span className="text-muted-foreground">- {c.match_reason}</span></span>
              {canManage && <Button size="sm" variant="ghost" disabled={busy} onClick={() => doLink(c.customer_id)}>Link anyway</Button>}
            </div>
          ))}
        </div>
      )}
      {canManage && (
        <div>
          <Button size="sm" variant="outline" onClick={() => setPicking((v) => !v)}>Link customer</Button>
          {picking && (
            <div className="mt-1 space-y-1 rounded-lg border border-border p-2">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers..." aria-label="Search customers" className="h-[var(--control-h-sm)] text-xs" />
              {(searchResults || []).slice(0, 6).map((c) => (
                <button key={c.id} disabled={busy} className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1.5 text-left hover:bg-accent" onClick={() => doLink(c.id)}>
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

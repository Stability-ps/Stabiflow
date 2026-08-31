import { supabase } from "@/integrations/supabase/client";

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    // Surface the edge function's curated { error } body (403/404/409/…),
    // not the generic "non-2xx status code". supabase-js exposes the raw
    // Response on error.context for non-2xx invocations.
    let message = (data as { error?: string } | null)?.error || "";
    const ctx = (error as { context?: unknown }).context;
    if (!message && ctx && typeof (ctx as Response).clone === "function") {
      try {
        const parsed = await (ctx as Response).clone().json();
        if (parsed && typeof parsed.error === "string") message = parsed.error;
      } catch {
        // body was not JSON - fall through to error.message
      }
    }
    throw new Error(message || error.message || `${name} failed`);
  }
  if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
}

export type DuplicateLeadCandidate = {
  id: string;
  human_reference: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  created_from_conversation_id: string | null;
};

function runLeadsAction<T>(workspaceId: string, action: string, params: Record<string, unknown> = {}) {
  return invoke<T>("leads-actions", { workspace_id: workspaceId, action, ...params });
}

export function checkDuplicateLeads(workspaceId: string, params: { phone?: string; conversationId?: string }) {
  return runLeadsAction<{ candidates: DuplicateLeadCandidate[] }>(workspaceId, "check_duplicates", {
    phone: params.phone,
    conversation_id: params.conversationId,
  });
}

export type ConversationContextResult = {
  summary_copied?: boolean;
  summary_overwritten?: boolean;
  summary_skipped?: boolean;
  intake_copied?: boolean;
  intake_new_keys?: string[];
  typed_fields_mapped?: string[];
  attachments_linked?: number;
};

export function createLeadFromConversation(workspaceId: string, conversationId: string, force = false) {
  return runLeadsAction<{
    lead?: unknown;
    created: boolean;
    already_linked?: boolean;
    duplicates?: DuplicateLeadCandidate[];
    context?: ConversationContextResult;
  }>(workspaceId, "create_from_conversation", { conversation_id: conversationId, force });
}

export function createLeadManual(workspaceId: string, params: {
  contactName: string; phone?: string; email?: string; companyName?: string; source: string; sourceDetail?: string; estimatedValue?: number; force?: boolean;
}) {
  return runLeadsAction<{ lead?: unknown; created: boolean; duplicates?: DuplicateLeadCandidate[] }>(workspaceId, "create_manual", {
    contact_name: params.contactName,
    phone: params.phone,
    email: params.email,
    company_name: params.companyName,
    source: params.source,
    source_detail: params.sourceDetail,
    estimated_value: params.estimatedValue,
    force: params.force,
  });
}

export function linkLeadConversation(
  workspaceId: string,
  leadId: string,
  conversationId: string,
  opts: { applyContext?: boolean; overwriteSummary?: boolean } = {},
) {
  return runLeadsAction<{ ok: true; context: ConversationContextResult | null }>(workspaceId, "link_conversation", {
    lead_id: leadId,
    conversation_id: conversationId,
    // Backend default is apply_context: true; only send the flag when the
    // caller explicitly opts out, or opts in to overwriting the summary.
    ...(opts.applyContext === false ? { apply_context: false } : {}),
    ...(opts.overwriteSummary ? { overwrite_summary: true } : {}),
  });
}

// Mint a short-lived signed URL for a lead attachment. The storage path is
// resolved server-side (leads-actions re-checks the attachment -> lead ->
// workspace chain and lead.view); the client only ever holds the signed
// URL, never the raw path.
export function signLeadAttachment(workspaceId: string, attachmentId: string) {
  return runLeadsAction<{ url: string }>(workspaceId, "sign_lead_attachment", { attachment_id: attachmentId });
}

export function assignLead(workspaceId: string, leadId: string, staffId: string) {
  return runLeadsAction<{ ok: true }>(workspaceId, "assign", { target_type: "lead", target_id: leadId, staff_id: staffId });
}

export function assignOpportunity(workspaceId: string, opportunityId: string, staffId: string) {
  return runLeadsAction<{ ok: true }>(workspaceId, "assign", { target_type: "opportunity", target_id: opportunityId, staff_id: staffId });
}

export function setLeadQualification(workspaceId: string, leadId: string, params: {
  qualificationStatus: string; qualificationNotes?: string; qualificationReason?: string; estimatedValue?: number;
}) {
  return runLeadsAction<{ ok: true }>(workspaceId, "set_qualification", {
    lead_id: leadId,
    qualification_status: params.qualificationStatus,
    qualification_notes: params.qualificationNotes,
    qualification_reason: params.qualificationReason,
    estimated_value: params.estimatedValue,
  });
}

export function moveLeadStage(workspaceId: string, leadId: string, pipelineId: string, pipelineStageId: string) {
  return runLeadsAction<{ ok: true }>(workspaceId, "move_stage", { lead_id: leadId, pipeline_id: pipelineId, pipeline_stage_id: pipelineStageId });
}

export function markLeadLost(workspaceId: string, leadId: string, lostReason?: string) {
  return runLeadsAction<{ ok: true }>(workspaceId, "mark_lead_lost", { lead_id: leadId, lost_reason: lostReason });
}

export function reopenLead(workspaceId: string, leadId: string) {
  return runLeadsAction<{ ok: true }>(workspaceId, "reopen_lead", { lead_id: leadId });
}

export function addCrmNote(workspaceId: string, targetType: "lead" | "opportunity", targetId: string, note: string) {
  return runLeadsAction<{ ok: true }>(workspaceId, "add_note", { target_type: targetType, target_id: targetId, note });
}

export function createOpportunity(workspaceId: string, params: {
  leadId: string; title: string; description?: string; pipelineId?: string; pipelineStageId?: string; estimatedValue?: number; assignedTo?: string;
}) {
  return runLeadsAction<{ opportunity: unknown }>(workspaceId, "create_opportunity", {
    lead_id: params.leadId,
    title: params.title,
    description: params.description,
    pipeline_id: params.pipelineId,
    pipeline_stage_id: params.pipelineStageId,
    estimated_value: params.estimatedValue,
    assigned_to: params.assignedTo,
  });
}

export function moveOpportunityStage(workspaceId: string, opportunityId: string, pipelineStageId: string) {
  return runLeadsAction<{ ok: true }>(workspaceId, "move_opportunity_stage", { opportunity_id: opportunityId, pipeline_stage_id: pipelineStageId });
}

export function markOpportunityWon(workspaceId: string, opportunityId: string, params: { actualValue?: number; createCustomer?: boolean } = {}) {
  return runLeadsAction<{ ok: true; customer: unknown }>(workspaceId, "mark_opportunity_won", {
    opportunity_id: opportunityId,
    actual_value: params.actualValue,
    create_customer: params.createCustomer,
  });
}

export function markOpportunityLost(workspaceId: string, opportunityId: string, lostReason?: string) {
  return runLeadsAction<{ ok: true }>(workspaceId, "mark_opportunity_lost", { opportunity_id: opportunityId, lost_reason: lostReason });
}

export function reopenOpportunity(workspaceId: string, opportunityId: string) {
  return runLeadsAction<{ ok: true }>(workspaceId, "reopen_opportunity", { opportunity_id: opportunityId });
}

// --- pipelines-actions -------------------------------------------------------

function runPipelinesAction<T>(workspaceId: string, action: string, params: Record<string, unknown> = {}) {
  return invoke<T>("pipelines-actions", { workspace_id: workspaceId, action, ...params });
}

// No client caller remains: every workspace's default pipeline is now
// created atomically by create_workspace() itself
// (20260906060000_default_pipeline_lifecycle_fix.sql), so the frontend
// never needs to trigger this. The ensure_default_pipeline action itself
// is kept server-side (pipelines-actions) as a defensive/recovery
// mechanism - reachable directly via the API if ever needed, deliberately
// not wired into the UI.

export function createPipeline(workspaceId: string, name: string) {
  return runPipelinesAction<{ pipeline: unknown }>(workspaceId, "create_pipeline", { name });
}

export function renamePipeline(workspaceId: string, pipelineId: string, name: string) {
  return runPipelinesAction<{ ok: true }>(workspaceId, "rename_pipeline", { pipeline_id: pipelineId, name });
}

export function setDefaultPipeline(workspaceId: string, pipelineId: string) {
  return runPipelinesAction<{ ok: true }>(workspaceId, "set_default_pipeline", { pipeline_id: pipelineId });
}

export function addPipelineStage(workspaceId: string, pipelineId: string, name: string) {
  return runPipelinesAction<{ stage: unknown }>(workspaceId, "add_stage", { pipeline_id: pipelineId, name });
}

export function renamePipelineStage(workspaceId: string, stageId: string, name: string) {
  return runPipelinesAction<{ ok: true }>(workspaceId, "rename_stage", { stage_id: stageId, name });
}

export function reorderPipelineStages(workspaceId: string, pipelineId: string, stageIds: string[]) {
  return runPipelinesAction<{ ok: true }>(workspaceId, "reorder_stages", { pipeline_id: pipelineId, stage_ids: stageIds });
}

export function setPipelineStageActive(workspaceId: string, stageId: string, isActive: boolean) {
  return runPipelinesAction<{ ok: true }>(workspaceId, "set_stage_active", { stage_id: stageId, is_active: isActive });
}

export function setPipelineStageFlags(workspaceId: string, stageId: string, flags: { isWonStage?: boolean; isLostStage?: boolean }) {
  return runPipelinesAction<{ ok: true }>(workspaceId, "set_stage_flags", { stage_id: stageId, is_won_stage: flags.isWonStage, is_lost_stage: flags.isLostStage });
}

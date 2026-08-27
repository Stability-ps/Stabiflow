// Staff actions on Leads/Opportunities (Phase E). Same dispatcher shape as
// inbox-actions (Phase D): ONE endpoint, one `action` field, every action
// server-side so it gets the same permission check, workspace-membership
// cross-check, and audit trail into the shared workspace_activity_log -
// never a forked audit table, never a direct client write for anything
// that has cross-cutting business rules (duplicate detection, workspace
// consistency, won/lost semantics).
//
// Reference: Acapolite's "Open Request" workflow (opening a structured
// record from a conversation, staff ownership, notes, status changes,
// audit logging, resolved/open lifecycle) - generalized here into a
// source-agnostic Lead/Opportunity model, never its tax-specific request
// schema or terminology.
import { bearerToken, createCallerClient, createServiceClient, getCallerUserId, hasWorkspacePermission, json, type AnySupabaseClient } from "../_shared/contentAuth.ts";
import { normalizePhoneNumber } from "../_shared/phone.ts";
import { emitDomainEvent } from "../_shared/automations/emitDomainEvent.ts";
import type { EventType } from "../_shared/automations/taxonomy.ts";

const VALID_ACTIONS = new Set([
  "check_duplicates",
  "create_from_conversation",
  "create_manual",
  "link_conversation",
  "assign",
  "set_qualification",
  "move_stage",
  "mark_lead_lost",
  "reopen_lead",
  "add_note",
  "create_opportunity",
  "move_opportunity_stage",
  "mark_opportunity_won",
  "mark_opportunity_lost",
  "reopen_opportunity",
  "override_attribution",
]);

const LEAD_SOURCES = new Set(["whatsapp", "meta", "website", "manual", "referral", "organic", "google_later", "other"]);
const QUALIFICATION_STATUSES = new Set(["unqualified", "qualifying", "qualified", "not_qualified"]);

// Phase G additive-backfill (never rewrite, never duplicate): the ORIGINAL
// attribution_events row(s) recorded when a touchpoint first happened get
// a downstream id filled in as the entity that touchpoint fed progresses
// through the funnel - occurred_at and every evidence field are untouched.
async function backfillAttribution(sb: AnySupabaseClient, column: "lead_id" | "opportunity_id" | "customer_id", value: string, matchColumn: "conversation_id" | "lead_id" | "opportunity_id", matchValue: string) {
  await sb.from("attribution_events").update({ [column]: value }).eq(matchColumn, matchValue).is(column, null);
}

async function logActivity(sb: AnySupabaseClient, workspaceId: string, actorId: string, action: string, targetType: string, targetId: string | null, metadata: Record<string, unknown> = {}) {
  await sb.from("workspace_activity_log").insert({ workspace_id: workspaceId, actor_user_id: actorId, action, target_type: targetType, target_id: targetId, metadata });
}

async function findDuplicateLeads(sb: AnySupabaseClient, workspaceId: string, phoneNormalized: string | null, conversationId: string | null) {
  if (!phoneNormalized && !conversationId) return [];
  const orClauses: string[] = [];
  if (phoneNormalized) orClauses.push(`phone_normalized.eq.${phoneNormalized}`);
  if (conversationId) orClauses.push(`created_from_conversation_id.eq.${conversationId}`);
  const { data } = await sb
    .from("leads")
    .select("id, human_reference, contact_name, phone, email, status, created_from_conversation_id")
    .eq("workspace_id", workspaceId)
    .or(orClauses.join(","))
    .limit(5);
  return data || [];
}

async function isWorkspaceMember(sb: AnySupabaseClient, workspaceId: string, userId: string): Promise<boolean> {
  const { data } = await sb.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  return !!data;
}

// New leads land in the workspace's default pipeline's first active stage
// automatically, same as create_opportunity's own fallback - otherwise a
// lead created with no explicit pipeline can never appear on the Kanban
// board at all, since nothing in the UI lets a lead join a pipeline for
// the first time (only move BETWEEN stages once it's already in one).
//
// Defensively GUARANTEES a default pipeline exists (via the same
// authoritative public.ensure_default_pipeline() every other bootstrap
// path uses) rather than merely reading one - lead creation must never
// depend on create_workspace()'s own bootstrap or a prior /leads visit
// having already run. Idempotent and concurrency-safe: two simultaneous
// lead creations in a brand-new workspace both resolve to the SAME
// pipeline, never two defaults.
async function resolveDefaultPipelineFirstStage(sb: AnySupabaseClient, workspaceId: string, createdBy: string): Promise<{ pipelineId: string | null; stageId: string | null }> {
  const { data: ensured } = await sb.rpc("ensure_default_pipeline", { p_workspace_id: workspaceId, p_created_by: createdBy }).single();
  const pipelineId = ensured?.pipeline_id ?? null;
  if (!pipelineId) return { pipelineId: null, stageId: null };
  const { data: stage } = await sb.from("pipeline_stages").select("id").eq("workspace_id", workspaceId).eq("pipeline_id", pipelineId).eq("is_active", true).order("sort_order", { ascending: true }).limit(1).maybeSingle();
  return { pipelineId, stageId: stage?.id ?? null };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": req.headers.get("origin") || "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  }
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json(req, { error: "Forbidden" }, 403);
  const callerSb = createCallerClient(token);
  const actorId = await getCallerUserId(callerSb);
  if (!actorId) return json(req, { error: "Forbidden" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }

  const workspaceId = body.workspace_id;
  const action = body.action;
  if (typeof workspaceId !== "string" || !workspaceId) return json(req, { error: "workspace_id is required" }, 400);
  if (typeof action !== "string" || !VALID_ACTIONS.has(action)) return json(req, { error: "Unknown action" }, 400);

  const serviceSb = createServiceClient();
  const { data: actorProfile } = await serviceSb.from("profiles").select("full_name").eq("id", actorId).maybeSingle();
  const actorName = actorProfile?.full_name?.trim() || "Staff";
  const nowIso = new Date().toISOString();

  // Present only when this call was made BY automations-tick acting on an
  // automation's behalf (never sent by the browser) - threaded into every
  // domain event this request causes so loopGuard can see the full
  // causation chain. See _shared/automations/loopGuard.ts.
  const automationContext = body._automation_context as { runId: string; automationId: string; correlationId: string; depth: number } | undefined;
  const workspaceIdStr = workspaceId as string;
  function emitEvent(eventType: EventType, entityType: string, entityId: string | null, payload: Record<string, unknown>, dedupeKey: string) {
    return emitDomainEvent(serviceSb, {
      workspaceId: workspaceIdStr, eventType, entityType, entityId, payload, dedupeKey,
      causation: automationContext ? { runId: automationContext.runId, automationId: automationContext.automationId, correlationId: automationContext.correlationId, depth: automationContext.depth + 1 } : undefined,
    });
  }

  // --- read-only ---------------------------------------------------------

  if (action === "check_duplicates") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "lead.view"))) return json(req, { error: "Forbidden" }, 403);
    const phoneNormalized = normalizePhoneNumber(typeof body.phone === "string" ? body.phone : null);
    const conversationId = typeof body.conversation_id === "string" ? body.conversation_id : null;
    const candidates = await findDuplicateLeads(serviceSb, workspaceId, phoneNormalized, conversationId);
    return json(req, { candidates });
  }

  // --- lead creation -------------------------------------------------------

  if (action === "create_from_conversation") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "lead.create"))) return json(req, { error: "Forbidden" }, 403);
    const conversationId = body.conversation_id;
    if (typeof conversationId !== "string" || !conversationId) return json(req, { error: "conversation_id is required" }, 400);
    const force = body.force === true;

    const { data: conversation } = await serviceSb
      .from("inbox_conversations")
      .select("id, workspace_id, display_name, phone_number, wa_id, lead_id")
      .eq("id", conversationId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!conversation) return json(req, { error: "Conversation not found" }, 404);

    if (conversation.lead_id) {
      const { data: existingLead } = await serviceSb.from("leads").select("*").eq("id", conversation.lead_id).maybeSingle();
      return json(req, { lead: existingLead, created: false, already_linked: true });
    }

    const phoneNormalized = normalizePhoneNumber(conversation.phone_number);
    if (!force) {
      const duplicates = await findDuplicateLeads(serviceSb, workspaceId, phoneNormalized, null);
      if (duplicates.length > 0) return json(req, { duplicates, created: false });
    }

    const defaultPlacement = await resolveDefaultPipelineFirstStage(serviceSb, workspaceId, actorId);
    const { data: lead, error: leadError } = await serviceSb
      .from("leads")
      .insert({
        workspace_id: workspaceId,
        contact_name: conversation.display_name || null,
        phone: conversation.phone_number,
        phone_normalized: phoneNormalized,
        source: "whatsapp",
        created_from_conversation_id: conversationId,
        created_by: actorId,
        pipeline_id: defaultPlacement.pipelineId,
        pipeline_stage_id: defaultPlacement.stageId,
      })
      .select("*")
      .single();
    if (leadError || !lead) return json(req, { error: "Unable to create this lead" }, 500);

    await serviceSb.from("inbox_conversations").update({ lead_id: lead.id }).eq("id", conversationId);
    await backfillAttribution(serviceSb, "lead_id", lead.id, "conversation_id", conversationId);
    await logActivity(serviceSb, workspaceId, actorId, "lead_created", "lead", lead.id, { source: "whatsapp", conversation_id: conversationId });
    await logActivity(serviceSb, workspaceId, actorId, "lead_linked_conversation", "lead", lead.id, { conversation_id: conversationId });
    await emitEvent("lead.created", "lead", lead.id, { entity_id: lead.id, source: "whatsapp", conversation_id: conversationId }, `lead.created:${lead.id}`);

    return json(req, { lead, created: true });
  }

  if (action === "create_manual") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "lead.create"))) return json(req, { error: "Forbidden" }, 403);
    const contactName = typeof body.contact_name === "string" ? body.contact_name.trim() : "";
    const source = body.source;
    if (!contactName) return json(req, { error: "contact_name is required" }, 400);
    if (typeof source !== "string" || !LEAD_SOURCES.has(source)) return json(req, { error: "A valid source is required" }, 400);
    const force = body.force === true;
    const phoneRaw = typeof body.phone === "string" ? body.phone : null;
    const phoneNormalized = normalizePhoneNumber(phoneRaw);

    if (phoneNormalized && !force) {
      const duplicates = await findDuplicateLeads(serviceSb, workspaceId, phoneNormalized, null);
      if (duplicates.length > 0) return json(req, { duplicates, created: false });
    }

    const defaultPlacement = await resolveDefaultPipelineFirstStage(serviceSb, workspaceId, actorId);
    const { data: lead, error: leadError } = await serviceSb
      .from("leads")
      .insert({
        workspace_id: workspaceId,
        contact_name: contactName,
        phone: phoneRaw,
        phone_normalized: phoneNormalized,
        email: typeof body.email === "string" ? body.email.trim() || null : null,
        company_name: typeof body.company_name === "string" ? body.company_name.trim() || null : null,
        source,
        source_detail: typeof body.source_detail === "string" ? body.source_detail.trim() || null : null,
        estimated_value: typeof body.estimated_value === "number" ? body.estimated_value : null,
        created_by: actorId,
        pipeline_id: defaultPlacement.pipelineId,
        pipeline_stage_id: defaultPlacement.stageId,
      })
      .select("*")
      .single();
    if (leadError || !lead) return json(req, { error: "Unable to create this lead" }, 500);

    await logActivity(serviceSb, workspaceId, actorId, "lead_created", "lead", lead.id, { source });
    await emitEvent("lead.created", "lead", lead.id, { entity_id: lead.id, source }, `lead.created:${lead.id}`);
    return json(req, { lead, created: true });
  }

  if (action === "link_conversation") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "lead.edit"))) return json(req, { error: "Forbidden" }, 403);
    const leadId = body.lead_id;
    const conversationId = body.conversation_id;
    if (typeof leadId !== "string" || !leadId) return json(req, { error: "lead_id is required" }, 400);
    if (typeof conversationId !== "string" || !conversationId) return json(req, { error: "conversation_id is required" }, 400);

    const { data: lead } = await serviceSb.from("leads").select("id").eq("id", leadId).eq("workspace_id", workspaceId).maybeSingle();
    if (!lead) return json(req, { error: "Lead not found" }, 404);
    const { data: conversation } = await serviceSb.from("inbox_conversations").select("id").eq("id", conversationId).eq("workspace_id", workspaceId).maybeSingle();
    if (!conversation) return json(req, { error: "Conversation not found" }, 404);

    const { error } = await serviceSb.from("inbox_conversations").update({ lead_id: leadId }).eq("id", conversationId);
    if (error) return json(req, { error: "Unable to link this conversation" }, 500);
    await backfillAttribution(serviceSb, "lead_id", leadId, "conversation_id", conversationId);
    await logActivity(serviceSb, workspaceId, actorId, "lead_linked_conversation", "lead", leadId, { conversation_id: conversationId });
    return json(req, { ok: true });
  }

  // --- assignment ------------------------------------------------------------

  if (action === "assign") {
    const targetType = body.target_type;
    const targetId = body.target_id;
    const staffId = body.staff_id;
    if (targetType !== "lead" && targetType !== "opportunity") return json(req, { error: "target_type must be 'lead' or 'opportunity'" }, 400);
    if (typeof targetId !== "string" || !targetId) return json(req, { error: "target_id is required" }, 400);
    if (typeof staffId !== "string" || !staffId) return json(req, { error: "staff_id is required" }, 400);

    const requiredPermission = targetType === "lead" ? "lead.assign" : "opportunity.edit";
    if (!(await hasWorkspacePermission(callerSb, workspaceId, requiredPermission))) return json(req, { error: "Forbidden" }, 403);
    if (!(await isWorkspaceMember(serviceSb, workspaceId, staffId))) return json(req, { error: "That person is not a member of this workspace" }, 400);

    const table = targetType === "lead" ? "leads" : "opportunities";
    const { data: target } = await serviceSb.from(table).select("id").eq("id", targetId).eq("workspace_id", workspaceId).maybeSingle();
    if (!target) return json(req, { error: `${targetType === "lead" ? "Lead" : "Opportunity"} not found` }, 404);

    const { error } = await serviceSb.from(table).update({ assigned_to: staffId }).eq("id", targetId);
    if (error) return json(req, { error: "Unable to assign this record" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, `${targetType}_assigned`, targetType, targetId, { staff_id: staffId });
    return json(req, { ok: true });
  }

  // --- qualification / stage / lost / reopen (lead) ---------------------------

  if (action === "set_qualification") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "lead.edit"))) return json(req, { error: "Forbidden" }, 403);
    const leadId = body.lead_id;
    const qualificationStatus = body.qualification_status;
    if (typeof leadId !== "string" || !leadId) return json(req, { error: "lead_id is required" }, 400);
    if (typeof qualificationStatus !== "string" || !QUALIFICATION_STATUSES.has(qualificationStatus)) return json(req, { error: "A valid qualification_status is required" }, 400);
    const qualificationReason = typeof body.qualification_reason === "string" ? body.qualification_reason.trim() : "";
    if (qualificationStatus === "not_qualified" && !qualificationReason) {
      return json(req, { error: "A reason is required when marking a lead not qualified" }, 400);
    }

    const { data: lead } = await serviceSb.from("leads").select("id").eq("id", leadId).eq("workspace_id", workspaceId).maybeSingle();
    if (!lead) return json(req, { error: "Lead not found" }, 404);

    const { error } = await serviceSb.from("leads").update({
      qualification_status: qualificationStatus,
      qualification_notes: typeof body.qualification_notes === "string" ? body.qualification_notes.trim() || null : undefined,
      qualification_reason: qualificationReason || null,
      estimated_value: typeof body.estimated_value === "number" ? body.estimated_value : undefined,
    }).eq("id", leadId);
    if (error) return json(req, { error: "Unable to update qualification" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, "lead_qualification_changed", "lead", leadId, { qualification_status: qualificationStatus });
    if (qualificationStatus === "qualified") {
      await emitEvent("lead.qualified", "lead", leadId, { entity_id: leadId, qualification_status: qualificationStatus }, `lead.qualified:${leadId}:${nowIso}`);
    }
    return json(req, { ok: true });
  }

  if (action === "move_stage") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "lead.edit"))) return json(req, { error: "Forbidden" }, 403);
    const leadId = body.lead_id;
    const pipelineId = body.pipeline_id;
    const pipelineStageId = body.pipeline_stage_id;
    if (typeof leadId !== "string" || !leadId) return json(req, { error: "lead_id is required" }, 400);
    if (typeof pipelineId !== "string" || !pipelineId) return json(req, { error: "pipeline_id is required" }, 400);
    if (typeof pipelineStageId !== "string" || !pipelineStageId) return json(req, { error: "pipeline_stage_id is required" }, 400);

    const { data: lead } = await serviceSb.from("leads").select("id").eq("id", leadId).eq("workspace_id", workspaceId).maybeSingle();
    if (!lead) return json(req, { error: "Lead not found" }, 404);
    const { data: stage } = await serviceSb.from("pipeline_stages").select("id").eq("id", pipelineStageId).eq("workspace_id", workspaceId).eq("pipeline_id", pipelineId).maybeSingle();
    if (!stage) return json(req, { error: "That stage does not belong to this workspace/pipeline" }, 400);

    const { error } = await serviceSb.from("leads").update({ pipeline_id: pipelineId, pipeline_stage_id: pipelineStageId }).eq("id", leadId);
    if (error) return json(req, { error: "Unable to move this lead" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, "lead_stage_changed", "lead", leadId, { pipeline_id: pipelineId, pipeline_stage_id: pipelineStageId });
    await emitEvent("lead.stage_changed", "lead", leadId, { entity_id: leadId, pipeline_id: pipelineId, pipeline_stage_id: pipelineStageId }, `lead.stage_changed:${leadId}:${pipelineStageId}:${nowIso}`);
    return json(req, { ok: true });
  }

  if (action === "mark_lead_lost") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "lead.edit"))) return json(req, { error: "Forbidden" }, 403);
    const leadId = body.lead_id;
    if (typeof leadId !== "string" || !leadId) return json(req, { error: "lead_id is required" }, 400);
    const { data: lead } = await serviceSb.from("leads").select("id").eq("id", leadId).eq("workspace_id", workspaceId).maybeSingle();
    if (!lead) return json(req, { error: "Lead not found" }, 404);

    const { error } = await serviceSb.from("leads").update({
      status: "lost",
      lost_at: nowIso,
      lost_reason: typeof body.lost_reason === "string" ? body.lost_reason.trim() || null : null,
    }).eq("id", leadId);
    if (error) return json(req, { error: "Unable to mark this lead lost" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, "lead_marked_lost", "lead", leadId, {});
    return json(req, { ok: true });
  }

  if (action === "reopen_lead") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "lead.edit"))) return json(req, { error: "Forbidden" }, 403);
    const leadId = body.lead_id;
    if (typeof leadId !== "string" || !leadId) return json(req, { error: "lead_id is required" }, 400);
    const { data: lead } = await serviceSb.from("leads").select("id").eq("id", leadId).eq("workspace_id", workspaceId).maybeSingle();
    if (!lead) return json(req, { error: "Lead not found" }, 404);

    const { error } = await serviceSb.from("leads").update({ status: "active", lost_at: null }).eq("id", leadId);
    if (error) return json(req, { error: "Unable to reopen this lead" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, "lead_reopened", "lead", leadId, {});
    return json(req, { ok: true });
  }

  // --- notes -------------------------------------------------------------

  if (action === "add_note") {
    const targetType = body.target_type;
    const targetId = body.target_id;
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (targetType !== "lead" && targetType !== "opportunity") return json(req, { error: "target_type must be 'lead' or 'opportunity'" }, 400);
    if (typeof targetId !== "string" || !targetId) return json(req, { error: "target_id is required" }, 400);
    if (!note || note.length > 2000) return json(req, { error: "Note must be between 1 and 2000 characters" }, 400);

    const requiredPermission = targetType === "lead" ? "lead.edit" : "opportunity.edit";
    if (!(await hasWorkspacePermission(callerSb, workspaceId, requiredPermission))) return json(req, { error: "Forbidden" }, 403);

    const table = targetType === "lead" ? "leads" : "opportunities";
    const { data: target } = await serviceSb.from(table).select("id").eq("id", targetId).eq("workspace_id", workspaceId).maybeSingle();
    if (!target) return json(req, { error: `${targetType === "lead" ? "Lead" : "Opportunity"} not found` }, 404);

    const { error } = await serviceSb.from("crm_notes").insert({ workspace_id: workspaceId, target_type: targetType, target_id: targetId, author_id: actorId, author_name: actorName, body: note });
    if (error) return json(req, { error: "Unable to save this note" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, "note_added", targetType, targetId, {});
    return json(req, { ok: true });
  }

  // --- opportunities -------------------------------------------------------

  if (action === "create_opportunity") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "opportunity.create"))) return json(req, { error: "Forbidden" }, 403);
    const leadId = body.lead_id;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (typeof leadId !== "string" || !leadId) return json(req, { error: "lead_id is required" }, 400);
    if (!title) return json(req, { error: "title is required" }, 400);

    const { data: lead } = await serviceSb.from("leads").select("id, pipeline_id, pipeline_stage_id").eq("id", leadId).eq("workspace_id", workspaceId).maybeSingle();
    if (!lead) return json(req, { error: "Lead not found" }, 404);

    let pipelineId = typeof body.pipeline_id === "string" ? body.pipeline_id : lead.pipeline_id;
    let pipelineStageId = typeof body.pipeline_stage_id === "string" ? body.pipeline_stage_id : (pipelineId === lead.pipeline_id ? lead.pipeline_stage_id : null);

    if (!pipelineId) {
      const { data: defaultPipeline } = await serviceSb.from("pipelines").select("id").eq("workspace_id", workspaceId).eq("is_default", true).maybeSingle();
      pipelineId = defaultPipeline?.id ?? null;
      pipelineStageId = null;
    }

    const { data: opportunity, error } = await serviceSb
      .from("opportunities")
      .insert({
        workspace_id: workspaceId,
        lead_id: leadId,
        pipeline_id: pipelineId,
        pipeline_stage_id: pipelineStageId,
        title,
        description: typeof body.description === "string" ? body.description.trim() || null : null,
        assigned_to: typeof body.assigned_to === "string" ? body.assigned_to : null,
        estimated_value: typeof body.estimated_value === "number" ? body.estimated_value : null,
        created_by: actorId,
      })
      .select("*")
      .single();
    if (error || !opportunity) return json(req, { error: "Unable to create this opportunity" }, 500);
    await backfillAttribution(serviceSb, "opportunity_id", opportunity.id, "lead_id", leadId);
    await logActivity(serviceSb, workspaceId, actorId, "opportunity_created", "opportunity", opportunity.id, { lead_id: leadId });
    await emitEvent("opportunity.created", "opportunity", opportunity.id, { entity_id: opportunity.id, lead_id: leadId }, `opportunity.created:${opportunity.id}`);
    return json(req, { opportunity });
  }

  if (action === "move_opportunity_stage") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "opportunity.edit"))) return json(req, { error: "Forbidden" }, 403);
    const opportunityId = body.opportunity_id;
    const pipelineStageId = body.pipeline_stage_id;
    if (typeof opportunityId !== "string" || !opportunityId) return json(req, { error: "opportunity_id is required" }, 400);
    if (typeof pipelineStageId !== "string" || !pipelineStageId) return json(req, { error: "pipeline_stage_id is required" }, 400);

    const { data: opportunity } = await serviceSb.from("opportunities").select("id, pipeline_id").eq("id", opportunityId).eq("workspace_id", workspaceId).maybeSingle();
    if (!opportunity) return json(req, { error: "Opportunity not found" }, 404);
    const { data: stage } = await serviceSb.from("pipeline_stages").select("id").eq("id", pipelineStageId).eq("workspace_id", workspaceId).eq("pipeline_id", opportunity.pipeline_id).maybeSingle();
    if (!stage) return json(req, { error: "That stage does not belong to this opportunity's pipeline" }, 400);

    const { error } = await serviceSb.from("opportunities").update({ pipeline_stage_id: pipelineStageId }).eq("id", opportunityId);
    if (error) return json(req, { error: "Unable to move this opportunity" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, "opportunity_stage_changed", "opportunity", opportunityId, { pipeline_stage_id: pipelineStageId });
    await emitEvent("opportunity.stage_changed", "opportunity", opportunityId, { entity_id: opportunityId, pipeline_stage_id: pipelineStageId }, `opportunity.stage_changed:${opportunityId}:${pipelineStageId}:${nowIso}`);
    return json(req, { ok: true });
  }

  if (action === "mark_opportunity_won") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "opportunity.close"))) return json(req, { error: "Forbidden" }, 403);
    const opportunityId = body.opportunity_id;
    if (typeof opportunityId !== "string" || !opportunityId) return json(req, { error: "opportunity_id is required" }, 400);

    const { data: opportunity } = await serviceSb.from("opportunities").select("id, status, lead_id").eq("id", opportunityId).eq("workspace_id", workspaceId).maybeSingle();
    if (!opportunity) return json(req, { error: "Opportunity not found" }, 404);
    if (opportunity.status !== "open") return json(req, { error: "Only an open opportunity can be marked won" }, 409);

    const { error } = await serviceSb.from("opportunities").update({
      status: "won",
      won_at: nowIso,
      actual_value: typeof body.actual_value === "number" ? body.actual_value : null,
    }).eq("id", opportunityId);
    if (error) return json(req, { error: "Unable to mark this opportunity won" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, "opportunity_won", "opportunity", opportunityId, {});
    await emitEvent("opportunity.won", "opportunity", opportunityId, { entity_id: opportunityId, lead_id: opportunity.lead_id }, `opportunity.won:${opportunityId}`);

    let customer = null;
    if (body.create_customer === true) {
      const { data: lead } = await serviceSb.from("leads").select("id, contact_name, phone, email, company_name").eq("id", opportunity.lead_id).maybeSingle();
      const { data: createdCustomer, error: customerError } = await serviceSb
        .from("customers")
        .insert({
          workspace_id: workspaceId,
          lead_id: opportunity.lead_id,
          opportunity_id: opportunityId,
          name: lead?.contact_name || "Unknown",
          phone: lead?.phone ?? null,
          email: lead?.email ?? null,
          company_name: lead?.company_name ?? null,
          created_by: actorId,
        })
        .select("*")
        .single();
      if (!customerError && createdCustomer) {
        customer = createdCustomer;
        await serviceSb.from("leads").update({ status: "converted", converted_at: nowIso }).eq("id", opportunity.lead_id);
        await backfillAttribution(serviceSb, "customer_id", createdCustomer.id, "opportunity_id", opportunityId);
        await logActivity(serviceSb, workspaceId, actorId, "customer_created", "customer", createdCustomer.id, { lead_id: opportunity.lead_id, opportunity_id: opportunityId });
        await emitEvent("customer.created", "customer", createdCustomer.id, { entity_id: createdCustomer.id, lead_id: opportunity.lead_id, opportunity_id: opportunityId }, `customer.created:${createdCustomer.id}`);
      } else if (customerError?.code === "23505") {
        // Idempotent retry: a customer already exists for this opportunity.
        const { data: existingCustomer } = await serviceSb.from("customers").select("*").eq("opportunity_id", opportunityId).maybeSingle();
        customer = existingCustomer ?? null;
      }
    }

    return json(req, { ok: true, customer });
  }

  if (action === "mark_opportunity_lost") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "opportunity.close"))) return json(req, { error: "Forbidden" }, 403);
    const opportunityId = body.opportunity_id;
    if (typeof opportunityId !== "string" || !opportunityId) return json(req, { error: "opportunity_id is required" }, 400);

    const { data: opportunity } = await serviceSb.from("opportunities").select("id, status").eq("id", opportunityId).eq("workspace_id", workspaceId).maybeSingle();
    if (!opportunity) return json(req, { error: "Opportunity not found" }, 404);
    if (opportunity.status !== "open") return json(req, { error: "Only an open opportunity can be marked lost" }, 409);

    const { error } = await serviceSb.from("opportunities").update({
      status: "lost",
      lost_at: nowIso,
      lost_reason: typeof body.lost_reason === "string" ? body.lost_reason.trim() || null : null,
    }).eq("id", opportunityId);
    if (error) return json(req, { error: "Unable to mark this opportunity lost" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, "opportunity_lost", "opportunity", opportunityId, {});
    await emitEvent("opportunity.lost", "opportunity", opportunityId, { entity_id: opportunityId }, `opportunity.lost:${opportunityId}`);
    return json(req, { ok: true });
  }

  // --- manual attribution override (Phase G) ---------------------------------
  // "Never silently rewrite historical attribution" - this APPENDS a new
  // attribution_events row (attribution_method='manual', confidence='exact'
  // since a human is making an explicit, deliberate call) rather than
  // editing any existing row. The previous best-known source is recorded in
  // metadata for the explainability requirement, and a workspace_activity_log
  // entry captures actor/reason - manual overrides require attribution.manage
  // (stronger than the broad attribution.view every staff role gets).
  if (action === "override_attribution") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "attribution.manage"))) return json(req, { error: "Forbidden" }, 403);
    const targetType = body.target_type;
    const targetId = body.target_id;
    const newSource = typeof body.source === "string" ? body.source.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (targetType !== "lead" && targetType !== "opportunity" && targetType !== "customer") {
      return json(req, { error: "target_type must be 'lead', 'opportunity', or 'customer'" }, 400);
    }
    if (typeof targetId !== "string" || !targetId) return json(req, { error: "target_id is required" }, 400);
    if (!newSource) return json(req, { error: "source is required" }, 400);
    if (!reason) return json(req, { error: "A reason is required for a manual attribution override" }, 400);

    const table = targetType === "lead" ? "leads" : targetType === "opportunity" ? "opportunities" : "customers";
    const { data: target } = await serviceSb.from(table).select("id").eq("id", targetId).eq("workspace_id", workspaceId).maybeSingle();
    if (!target) return json(req, { error: `${targetType} not found` }, 404);

    const { data: previous } = await serviceSb
      .from("attribution_events")
      .select("source, attribution_confidence")
      .eq(`${targetType}_id`, targetId)
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const insertRow: Record<string, unknown> = {
      workspace_id: workspaceId,
      event_type: "manual_attribution_override",
      occurred_at: nowIso,
      platform: "manual",
      source_type: "unknown",
      source: newSource,
      attribution_method: "manual",
      attribution_confidence: "exact",
      attribution_source: "manual",
      metadata: { override: true, previous_source: previous?.source ?? null, previous_confidence: previous?.attribution_confidence ?? null, reason, overridden_by: actorId },
    };
    insertRow[`${targetType}_id`] = targetId;

    const { data: attributionEvent, error } = await serviceSb.from("attribution_events").insert(insertRow).select("id").single();
    if (error || !attributionEvent) return json(req, { error: "Unable to record this override" }, 500);
    await logActivity(serviceSb, workspaceId, actorId, "attribution_overridden", targetType, targetId, { new_source: newSource, reason });
    await emitEvent("attribution.created", "attribution_event", attributionEvent.id, { entity_id: attributionEvent.id, target_type: targetType, target_id: targetId, source: newSource }, `attribution.created:${attributionEvent.id}`);
    return json(req, { ok: true });
  }

  // action === "reopen_opportunity"
  if (!(await hasWorkspacePermission(callerSb, workspaceId, "opportunity.close"))) return json(req, { error: "Forbidden" }, 403);
  const opportunityId = body.opportunity_id;
  if (typeof opportunityId !== "string" || !opportunityId) return json(req, { error: "opportunity_id is required" }, 400);
  const { data: opportunity } = await serviceSb.from("opportunities").select("id, status").eq("id", opportunityId).eq("workspace_id", workspaceId).maybeSingle();
  if (!opportunity) return json(req, { error: "Opportunity not found" }, 404);
  if (opportunity.status === "open") return json(req, { error: "This opportunity is already open" }, 409);

  const { error } = await serviceSb.from("opportunities").update({ status: "open", won_at: null, lost_at: null, lost_reason: null }).eq("id", opportunityId);
  if (error) return json(req, { error: "Unable to reopen this opportunity" }, 500);
  await logActivity(serviceSb, workspaceId, actorId, "opportunity_reopened", "opportunity", opportunityId, {});
  return json(req, { ok: true });
});

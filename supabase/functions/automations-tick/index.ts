// Cron-triggered Automation Engine worker (Phase J). Invoked every minute
// by pg_cron via pg_net, same shape as content-publish-worker: a shared
// secret header, never a user session, since there is no live request to
// authorize against.
//
// Three phases per invocation, in order:
//  A. Match unprocessed domain_events against enabled automations for
//     their workspace+trigger_event_type, creating automation_runs
//     (idempotent via automation_runs' UNIQUE(automation_id,
//     domain_event_id) and refused outright by loopGuard for a direct
//     cycle or excess causation depth) - then mark each event processed.
//  B. Scan for lead.idle_timeout candidates (a lead with no activity for
//     longer than an enabled automation's configured threshold) and
//     synthesize a domain_events row for each, deduped per (lead,
//     automation, the exact updated_at observed) so the SAME idle episode
//     is never re-emitted every tick, but a lead that goes idle again
//     after new activity fires again.
//  C. Claim (atomic conditional UPDATE, same pattern as
//     content-publish-worker's claim) and execute pending/retry-due runs:
//     mint the automation creator's access token, re-check EVERY action's
//     required permission against their CURRENT membership
//     (has_workspace_permission_for - never cached from creation time),
//     evaluate conditions, execute actions via the SAME dispatchers the
//     UI uses, record per-step results, and decide the next state via
//     retryDecision.ts.
import { createServiceClient, envVar } from "../_shared/contentAuth.ts";
import { evaluateConditions } from "../_shared/automations/conditionEvaluator.ts";
import { checkLoopGuard } from "../_shared/automations/loopGuard.ts";
import { decideNextRunState } from "../_shared/automations/retryDecision.ts";
import { mintUserAccessToken } from "../_shared/automations/actAsUser.ts";
import { dispatchAction } from "../_shared/automations/actionDispatch.ts";
import { emitDomainEvent } from "../_shared/automations/emitDomainEvent.ts";
import { readIntakePayload } from "../_shared/inbox/intakeSchema.ts";

const EVENT_BATCH_LIMIT = 100;
const RUN_BATCH_LIMIT = 20;
const CLAIM_STALE_MINUTES = 10;
const IDLE_SCAN_LIMIT = 100;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

type DomainEventRow = {
  id: string;
  workspace_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  payload: Record<string, unknown>;
  caused_by_automation_id: string | null;
  causation_depth: number;
  correlation_id: string | null;
};

type AutomationRow = { id: string; workspace_id: string; name: string; status: string; created_by: string };

// Launch-completion: a suspended/cancelled workspace's automations are
// treated the same as the pre-existing per-workspace kill switch
// (limits.automations_disabled) - both mean "skip this workspace's
// automations entirely for this tick," so they share one query/helper
// rather than the cron worker checking two separate things at each call
// site. Mirrors the same workspace_billing.status values that
// _shared/workspaceStatus.ts's assertWorkspaceActive() gates every other
// costly/mutating entry point on (a separate helper here only because
// this one query already needed to fetch `limits` too - not a diverging
// definition of "blocked").
async function workspaceAutomationsDisabled(sb: ReturnType<typeof createServiceClient>, workspaceId: string): Promise<boolean> {
  const { data } = await sb.from("workspace_billing").select("limits, status").eq("workspace_id", workspaceId).maybeSingle();
  if ((data?.limits as Record<string, unknown> | null)?.automations_disabled === true) return true;
  const status = data?.status as string | undefined;
  return status === "suspended" || status === "cancelled";
}

// --- Phase A: match new events -> create runs -----------------------------

async function matchEventsToRuns(sb: ReturnType<typeof createServiceClient>) {
  const { data: events } = await sb.from("domain_events").select("*").is("processed_at", null).order("created_at", { ascending: true }).limit(EVENT_BATCH_LIMIT);
  let runsCreated = 0;
  for (const event of (events ?? []) as DomainEventRow[]) {
    if (!(await workspaceAutomationsDisabled(sb, event.workspace_id))) {
      const { data: automations } = await sb
        .from("automations")
        .select("id, workspace_id, name, status, created_by")
        .eq("workspace_id", event.workspace_id)
        .eq("trigger_event_type", event.event_type)
        .eq("status", "enabled");

      for (const automation of (automations ?? []) as AutomationRow[]) {
        const guard = checkLoopGuard({ eventCausedByAutomationId: event.caused_by_automation_id, eventCausationDepth: event.causation_depth }, automation.id);
        if (!guard.allowed) continue;

        const { error: insertError } = await sb.from("automation_runs").insert({
          automation_id: automation.id,
          workspace_id: automation.workspace_id,
          domain_event_id: event.id,
          status: "pending",
          causation_domain_event_id: event.id,
          correlation_id: event.correlation_id ?? crypto.randomUUID(),
          originating_automation_id: event.caused_by_automation_id,
          depth: event.causation_depth,
        });
        // A duplicate here just means this event/automation pair already
        // has a run (idempotency doing its job, not an error).
        if (!insertError) runsCreated++;
      }
    }
    await sb.from("domain_events").update({ processed_at: new Date().toISOString() }).eq("id", event.id);
  }
  return { eventsProcessed: (events ?? []).length, runsCreated };
}

// --- Phase B: idle-timeout scan --------------------------------------------

async function scanIdleTimeouts(sb: ReturnType<typeof createServiceClient>) {
  let emitted = 0;

  // lead.idle_timeout - unchanged.
  const { data: leadAutomations } = await sb.from("automations").select("id, workspace_id, idle_timeout_minutes").eq("trigger_event_type", "lead.idle_timeout").eq("status", "enabled");
  for (const automation of (leadAutomations ?? []) as { id: string; workspace_id: string; idle_timeout_minutes: number | null }[]) {
    if (!automation.idle_timeout_minutes) continue;
    if (await workspaceAutomationsDisabled(sb, automation.workspace_id)) continue;
    const cutoffIso = new Date(Date.now() - automation.idle_timeout_minutes * 60_000).toISOString();
    const { data: idleLeads } = await sb
      .from("leads")
      .select("id, updated_at")
      .eq("workspace_id", automation.workspace_id)
      .eq("status", "active")
      .lt("updated_at", cutoffIso)
      .limit(IDLE_SCAN_LIMIT);
    for (const lead of (idleLeads ?? []) as { id: string; updated_at: string }[]) {
      await emitDomainEvent(sb, {
        workspaceId: automation.workspace_id,
        eventType: "lead.idle_timeout",
        entityType: "lead",
        entityId: lead.id,
        payload: { entity_id: lead.id, updated_at: lead.updated_at, idle_timeout_minutes: automation.idle_timeout_minutes },
        dedupeKey: `lead.idle_timeout:${lead.id}:${automation.id}:${lead.updated_at}`,
      });
      emitted++;
    }
  }

  // Phase 8: conversation.idle_timeout - a customer conversation that has
  // gone quiet (no inbound message) for longer than the automation's
  // threshold, still open, workspace active. One bounded set-based scan per
  // enabled automation (backed by inbox_conversations_idle_idx). Deduped
  // per (conversation, automation, the exact last_inbound_at observed) so
  // the SAME idle episode never re-emits every tick; a new inbound message
  // moves last_inbound_at and starts a fresh episode. The sweep emits the
  // event only - automations decide what to do with it.
  const { data: convAutomations } = await sb.from("automations").select("id, workspace_id, idle_timeout_minutes").eq("trigger_event_type", "conversation.idle_timeout").eq("status", "enabled");
  for (const automation of (convAutomations ?? []) as { id: string; workspace_id: string; idle_timeout_minutes: number | null }[]) {
    if (!automation.idle_timeout_minutes || automation.idle_timeout_minutes <= 0) continue;
    if (await workspaceAutomationsDisabled(sb, automation.workspace_id)) continue;
    const cutoffIso = new Date(Date.now() - automation.idle_timeout_minutes * 60_000).toISOString();
    const { data: idleConvs } = await sb
      .from("inbox_conversations")
      .select("id, last_inbound_at")
      .eq("workspace_id", automation.workspace_id)
      .neq("status", "closed")
      .neq("inbox_status", "resolved")
      .not("last_inbound_at", "is", null)
      .lt("last_inbound_at", cutoffIso)
      .limit(IDLE_SCAN_LIMIT);
    for (const conv of (idleConvs ?? []) as { id: string; last_inbound_at: string }[]) {
      await emitDomainEvent(sb, {
        workspaceId: automation.workspace_id,
        eventType: "conversation.idle_timeout",
        entityType: "inbox_conversation",
        entityId: conv.id,
        payload: { entity_id: conv.id, conversation_id: conv.id, last_inbound_at: conv.last_inbound_at, idle_timeout_minutes: automation.idle_timeout_minutes },
        dedupeKey: `conversation.idle_timeout:${conv.id}:${automation.id}:${conv.last_inbound_at}`,
      });
      emitted++;
    }
  }

  return { idleEventsEmitted: emitted };
}

// Phase 8: conditions are evaluated against the event payload PLUS, for a
// conversation-scoped event, an authoritative snapshot of the conversation
// (status/priority/assignment/ai/source/intake-completion), its pinned
// intake fields (`intake.<key>` via the Phase-3 reader - never raw nested
// JSON the automation creator supplied), and the triggering message
// (direction/sender_type/message_type/media_mime_type). Every row is
// re-read workspace-scoped here, so a condition can only ever see
// workspace-owned data. The RAW payload is still what $event.* resolution
// uses in dispatchAction - only condition eval sees this enriched copy.
async function buildConditionPayload(
  sb: ReturnType<typeof createServiceClient>,
  event: { entity_type: string; entity_id: string | null; payload: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const base: Record<string, unknown> = { ...(event.payload ?? {}) };
  if (event.entity_type !== "inbox_conversation" || !event.entity_id) return base;

  const { data: conv } = await sb
    .from("inbox_conversations")
    .select("workspace_id, status, ai_enabled, inbox_status, priority_level, assigned_staff_id, referral_source, intake_completed_at, intake_payload")
    .eq("id", event.entity_id)
    .maybeSingle();
  if (!conv) return base;

  base.conversation = {
    status: conv.status,
    priority: conv.priority_level,
    ai_enabled: conv.ai_enabled,
    inbox_status: conv.inbox_status,
    assigned_staff_id: conv.assigned_staff_id ?? null,
    source: conv.referral_source ?? null,
    intake_completed: !!conv.intake_completed_at,
  };
  base.intake = readIntakePayload(conv.intake_payload).fields;

  const messageId = typeof base.message_id === "string" ? base.message_id : null;
  if (messageId) {
    const { data: msg } = await sb
      .from("inbox_messages")
      .select("direction, sender_type, message_type, media_mime_type")
      .eq("id", messageId)
      .eq("workspace_id", conv.workspace_id)
      .maybeSingle();
    if (msg) base.message = { direction: msg.direction, sender_type: msg.sender_type, message_type: msg.message_type, media_mime_type: msg.media_mime_type ?? null };
  }
  return base;
}

// --- Phase C: claim + execute due runs -------------------------------------

type RunCandidate = { id: string; automation_id: string; workspace_id: string; domain_event_id: string; attempt_count: number; correlation_id: string };

async function claimDueRuns(sb: ReturnType<typeof createServiceClient>): Promise<RunCandidate[]> {
  const nowIso = new Date().toISOString();
  const staleCutoffIso = new Date(Date.now() - CLAIM_STALE_MINUTES * 60_000).toISOString();
  const workerId = crypto.randomUUID();
  const claimed: RunCandidate[] = [];

  // Fresh claim: pending, due (or never scheduled a retry), never claimed.
  const { data: candidates } = await sb
    .from("automation_runs")
    .select("id, automation_id, workspace_id, domain_event_id, attempt_count, correlation_id")
    .eq("status", "pending")
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .is("claimed_at", null)
    .limit(RUN_BATCH_LIMIT);
  for (const candidate of (candidates ?? []) as RunCandidate[]) {
    const { data: claimResult } = await sb
      .from("automation_runs")
      .update({ status: "in_progress", claimed_at: nowIso, claimed_by: workerId, started_at: nowIso })
      .eq("id", candidate.id)
      .eq("status", "pending")
      .is("claimed_at", null)
      .select("id")
      .maybeSingle();
    if (claimResult) claimed.push(candidate);
  }

  // Stale reclaim: a worker crashed mid-execution before recording a result.
  const { data: staleCandidates } = await sb
    .from("automation_runs")
    .select("id, automation_id, workspace_id, domain_event_id, attempt_count, correlation_id")
    .eq("status", "in_progress")
    .lt("claimed_at", staleCutoffIso)
    .limit(RUN_BATCH_LIMIT);
  for (const candidate of (staleCandidates ?? []) as RunCandidate[]) {
    const { data: claimResult } = await sb
      .from("automation_runs")
      .update({ claimed_at: nowIso, claimed_by: workerId })
      .eq("id", candidate.id)
      .eq("status", "in_progress")
      .lt("claimed_at", staleCutoffIso)
      .select("id")
      .maybeSingle();
    if (claimResult) claimed.push(candidate);
  }

  return claimed;
}

async function executeRun(sb: ReturnType<typeof createServiceClient>, run: RunCandidate) {
  const { data: automation } = await sb.from("automations").select("*").eq("id", run.automation_id).maybeSingle();
  const { data: event } = await sb.from("domain_events").select("*").eq("id", run.domain_event_id).maybeSingle();
  const { data: conditions } = await sb.from("automation_conditions").select("field, operator, value").eq("automation_id", run.automation_id).order("sort_order");
  const { data: actions } = await sb.from("automation_actions").select("action_type, action_config").eq("automation_id", run.automation_id).order("sort_order");

  if (!automation || !event) {
    await sb.from("automation_runs").update({ status: "failed", finished_at: new Date().toISOString(), error: { message: "automation or triggering event no longer exists" } }).eq("id", run.id);
    return;
  }
  if (automation.status !== "enabled") {
    await sb.from("automation_runs").update({ status: "skipped_conditions_not_met", finished_at: new Date().toISOString() }).eq("id", run.id);
    return;
  }

  const conditionPayload = await buildConditionPayload(sb, { entity_type: event.entity_type, entity_id: event.entity_id, payload: event.payload as Record<string, unknown> });
  const { allPassed, results } = evaluateConditions((conditions ?? []) as { field: string; operator: string; value: unknown }[], conditionPayload);
  if (!allPassed) {
    await sb.from("automation_runs").update({ status: "skipped_conditions_not_met", conditions_result: results, finished_at: new Date().toISOString() }).eq("id", run.id);
    return;
  }

  const accessToken = await mintUserAccessToken(sb, automation.created_by);
  if (!accessToken) {
    await sb.from("automation_runs").update({ status: "blocked_permission", conditions_result: results, finished_at: new Date().toISOString(), error: { message: "Could not act as this automation's creator - they may no longer exist." } }).eq("id", run.id);
    return;
  }

  let anyFailed = false;
  let anySucceeded = false;
  let lastError: string | null = null;
  const actionRows = (actions ?? []) as { action_type: string; action_config: Record<string, unknown> }[];
  for (let i = 0; i < actionRows.length; i++) {
    const action = actionRows[i];
    if (!anyFailed) {
      const { data: stepRow } = await sb.from("automation_run_steps").insert({ run_id: run.id, workspace_id: run.workspace_id, sort_order: i, action_type: action.action_type, status: "pending", started_at: new Date().toISOString() }).select("id").single();
      const result = await dispatchAction({
        actionType: action.action_type as never,
        actionConfig: action.action_config ?? {},
        event: { entityType: event.entity_type, entityId: event.entity_id, payload: event.payload as Record<string, unknown> },
        workspaceId: run.workspace_id,
        accessToken,
        serviceClient: sb,
        actorUserId: automation.created_by,
        automationContext: { runId: run.id, automationId: run.automation_id, correlationId: run.correlation_id, depth: event.causation_depth, actionIndex: i },
      });
      await sb.from("automation_run_steps").update({ status: result.status, result: result.result ?? null, error: result.error ? { message: result.error } : null, finished_at: new Date().toISOString() }).eq("id", stepRow?.id);
      if (result.status === "succeeded") anySucceeded = true;
      else {
        anyFailed = true;
        lastError = result.error ?? "Unknown error";
      }
    } else {
      // A prior step already failed this run - remaining actions are
      // recorded as skipped, never executed, and never re-run on retry
      // once earlier steps have already succeeded (that bookkeeping lives
      // in automation_run_steps, not re-derived from scratch).
      await sb.from("automation_run_steps").insert({ run_id: run.id, workspace_id: run.workspace_id, sort_order: i, action_type: action.action_type, status: "skipped" });
    }
  }

  const outcome = anyFailed ? (anySucceeded ? { kind: "partial" as const } : { kind: "temporary_failure" as const, code: "action_failed", message: lastError ?? "Action failed" }) : { kind: "success" as const };
  const next = decideNextRunState({ attemptCount: run.attempt_count }, outcome, new Date());
  await sb
    .from("automation_runs")
    .update({
      status: next.status,
      conditions_result: results,
      attempt_count: next.attemptCount,
      next_retry_at: next.status === "pending" ? next.nextRetryAt.toISOString() : null,
      finished_at: next.status === "pending" ? null : new Date().toISOString(),
      claimed_at: next.status === "pending" ? null : undefined, // release the claim so a future tick can retry it
      error: anyFailed ? { message: lastError } : null,
    })
    .eq("id", run.id);
}

Deno.serve(async (req: Request) => {
  const providedSecret = req.headers.get("x-cron-secret") || "";
  if (!timingSafeEqual(providedSecret, envVar("AUTOMATIONS_CRON_SECRET"))) {
    return json({ error: "Forbidden" }, 403);
  }
  if (envVar("AUTOMATIONS_ENABLED").trim().toLowerCase() !== "true") {
    return json({ ok: true, skipped: "AUTOMATIONS_ENABLED is not true" });
  }

  const sb = createServiceClient();
  const matchResult = await matchEventsToRuns(sb);
  const idleResult = await scanIdleTimeouts(sb);
  const claimed = await claimDueRuns(sb);
  for (const run of claimed) await executeRun(sb, run);

  return json({ ok: true, ...matchResult, ...idleResult, runsExecuted: claimed.length });
});

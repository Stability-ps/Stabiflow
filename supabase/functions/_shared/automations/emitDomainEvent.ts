// Best-effort domain event emission - called as ONE ADDITIONAL line
// alongside each dispatcher's existing logActivity() call, never a new
// business-logic path of its own. Must NEVER throw or block the caller's
// primary transaction: a failed event emission means an automation might
// not fire, which is far better than a real user-facing mutation (create
// a lead, move a stage) failing because of automation plumbing.
import type { AnySupabaseClient } from "../contentAuth.ts";
import { isEventType, type EventType } from "./taxonomy.ts";

export type EmitDomainEventInput = {
  workspaceId: string;
  eventType: EventType;
  entityType: string;
  entityId: string | null;
  payload: Record<string, unknown>;
  // Deterministic and unique per real-world occurrence - e.g.
  // `lead.created:${leadId}` (an entity is only ever created once) or
  // `lead.stage_changed:${leadId}:${pipelineStageId}:${occurredAtIso}`
  // for a repeatable transition. The caller owns picking a key that is
  // stable across a retried request but distinct across genuinely
  // different occurrences.
  dedupeKey: string;
  occurredAt?: string;
  // Present only when this event was produced BY an automation's action
  // (never for a genuine user/system-triggered event) - see loopGuard.ts.
  causation?: { runId: string; automationId: string; correlationId: string; depth: number };
};

export async function emitDomainEvent(serviceClient: AnySupabaseClient, input: EmitDomainEventInput): Promise<void> {
  if (!isEventType(input.eventType)) {
    console.error(`emitDomainEvent: refusing to emit unknown event_type "${input.eventType}"`);
    return;
  }
  try {
    const { error } = await serviceClient.from("domain_events").insert({
      workspace_id: input.workspaceId,
      event_type: input.eventType,
      entity_type: input.entityType,
      entity_id: input.entityId,
      payload: input.payload,
      dedupe_key: input.dedupeKey,
      occurred_at: input.occurredAt ?? new Date().toISOString(),
      caused_by_run_id: input.causation?.runId ?? null,
      caused_by_automation_id: input.causation?.automationId ?? null,
      correlation_id: input.causation?.correlationId ?? null,
      causation_depth: input.causation?.depth ?? 0,
    });
    // A duplicate-key error on dedupe_key means this exact event was
    // already emitted (e.g. the caller itself retried) - that is the
    // dedupe key doing its job, not a real failure.
    if (error && !`${error.message ?? ""}`.toLowerCase().includes("duplicate key")) {
      console.error("emitDomainEvent: insert failed", input.eventType, error.message);
    }
  } catch (err) {
    console.error("emitDomainEvent: unexpected failure", input.eventType, err instanceof Error ? err.message : String(err));
  }
}

// Phase G. Revenue events - deliberately minimal (no invoicing, no
// accounting): a "Record Revenue" action and a narrow "correct the
// reference note" edit, both going through this dispatcher (same shape as
// leads-actions) purely so every write also lands a workspace_activity_log
// entry - RLS alone would allow a direct client insert, but the activity
// log requirement ("revenue recorded/edited/reversed") needs a server-side
// step regardless.
//
// amount_minor + currency are never touched by "edit" - a correction to
// the actual financial substance is a NEW event (event_type='adjustment'
// or 'refund'), never a rewrite of a past one. This mirrors the
// append-only convention attribution_events already established.
import { bearerToken, createCallerClient, createServiceClient, getCallerUserId, hasWorkspacePermission, json, type AnySupabaseClient } from "../_shared/contentAuth.ts";
import { emitDomainEvent } from "../_shared/automations/emitDomainEvent.ts";

const VALID_ACTIONS = new Set(["record", "edit_reference"]);
const EVENT_TYPES = new Set(["sale", "payment", "contract_value", "adjustment", "refund"]);
const CURRENCY_RE = /^[A-Z]{3}$/;

async function logActivity(sb: AnySupabaseClient, workspaceId: string, actorId: string, action: string, targetId: string | null, metadata: Record<string, unknown> = {}) {
  await sb.from("workspace_activity_log").insert({ workspace_id: workspaceId, actor_user_id: actorId, action, target_type: "revenue_event", target_id: targetId, metadata });
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
  const nowIso = new Date().toISOString();

  if (action === "record") {
    if (!(await hasWorkspacePermission(callerSb, workspaceId, "revenue.create"))) return json(req, { error: "Forbidden" }, 403);

    const amountMinor = body.amount_minor;
    const currency = body.currency;
    const eventType = body.event_type;
    const customerId = typeof body.customer_id === "string" ? body.customer_id : null;
    const opportunityId = typeof body.opportunity_id === "string" ? body.opportunity_id : null;
    const leadId = typeof body.lead_id === "string" ? body.lead_id : null;

    if (typeof amountMinor !== "number" || !Number.isInteger(amountMinor) || amountMinor === 0) {
      return json(req, { error: "amount_minor must be a non-zero integer" }, 400);
    }
    if (typeof currency !== "string" || !CURRENCY_RE.test(currency)) return json(req, { error: "currency must be a 3-letter ISO code" }, 400);
    if (typeof eventType !== "string" || !EVENT_TYPES.has(eventType)) return json(req, { error: "A valid event_type is required" }, 400);
    if (!customerId && !opportunityId && !leadId) return json(req, { error: "At least one of customer_id, opportunity_id, or lead_id is required" }, 400);

    for (const [table, id] of [["customers", customerId], ["opportunities", opportunityId], ["leads", leadId]] as const) {
      if (!id) continue;
      const { data: row } = await serviceSb.from(table).select("id").eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
      if (!row) return json(req, { error: `Linked ${table.slice(0, -1)} not found in this workspace` }, 404);
    }

    const { data: revenueEvent, error } = await serviceSb
      .from("revenue_events")
      .insert({
        workspace_id: workspaceId,
        customer_id: customerId,
        opportunity_id: opportunityId,
        lead_id: leadId,
        amount_minor: amountMinor,
        currency,
        event_type: eventType,
        occurred_at: typeof body.occurred_at === "string" ? body.occurred_at : nowIso,
        reference: typeof body.reference === "string" ? body.reference.trim() || null : null,
        created_by: actorId,
      })
      .select("*")
      .single();
    if (error || !revenueEvent) return json(req, { error: "Unable to record this revenue event" }, 500);

    await logActivity(serviceSb, workspaceId, actorId, "revenue_recorded", revenueEvent.id, { event_type: eventType, amount_minor: amountMinor, currency });
    await emitDomainEvent(serviceSb, {
      workspaceId, eventType: "revenue.recorded", entityType: "revenue_event", entityId: revenueEvent.id,
      payload: { entity_id: revenueEvent.id, amount_minor: amountMinor, currency, revenue_event_type: eventType, customer_id: customerId, opportunity_id: opportunityId, lead_id: leadId },
      dedupeKey: `revenue.recorded:${revenueEvent.id}`,
    });
    return json(req, { revenue_event: revenueEvent });
  }

  // action === "edit_reference"
  if (!(await hasWorkspacePermission(callerSb, workspaceId, "revenue.edit"))) return json(req, { error: "Forbidden" }, 403);
  const revenueEventId = body.revenue_event_id;
  if (typeof revenueEventId !== "string" || !revenueEventId) return json(req, { error: "revenue_event_id is required" }, 400);
  const { data: existing } = await serviceSb.from("revenue_events").select("id").eq("id", revenueEventId).eq("workspace_id", workspaceId).maybeSingle();
  if (!existing) return json(req, { error: "Revenue event not found" }, 404);

  const { error } = await serviceSb.from("revenue_events").update({ reference: typeof body.reference === "string" ? body.reference.trim() || null : null }).eq("id", revenueEventId);
  if (error) return json(req, { error: "Unable to update this revenue event" }, 500);
  await logActivity(serviceSb, workspaceId, actorId, "revenue_edited", revenueEventId, {});
  return json(req, { ok: true });
});

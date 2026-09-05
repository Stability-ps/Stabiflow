// Retention V1 - cron-triggered (pg_cron -> pg_net, see
// 20261005060000_retention_v1.sql), authorised by a shared secret header
// only, exactly like whatsapp-sla-tick / whatsapp-outbound-retry-tick.
//
// One bounded, conservative-batch pass per category, in this order:
//   1. text/no-media messages older than 730d (fully atomic SQL delete -
//      no external step, so no claim needed)
//   2. media-bearing messages older than 730d: claim -> delete the
//      Storage object -> confirm-delete the DB row. A Storage failure
//      releases the claim and leaves the DB row for a later tick - it is
//      NEVER deleted before its Storage object is confirmed gone, so a
//      partial failure never orphans a live storage.googleapis-style
//      object with no DB record pointing at it.
//   3. resolved inbox alerts older than 90d
//   4. terminal automation runs older than 180d
//   5. ai_usage_events older than 730d
//   6. empty, dependency-free conversations older than 730d (run LAST so
//      this tick's own message cleanup above already applies)
//
// Every delete is a single atomic SQL statement (see the migration) - this
// function does no row-level SQL itself beyond calling those RPCs, and
// logs only counts/ids, never message content.
import { createServiceClient, envVar } from "../_shared/contentAuth.ts";
import { deleteMediaBatch } from "../_shared/retention/retentionMedia.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

const DAY_MS = 24 * 60 * 60 * 1000;
function cutoff(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

// Conservative, bounded batch sizes (Phase Z: "use conservative small
// batch sizes... do not perform an unbounded historical purge"). A large
// backlog drains across several daily ticks rather than in one pass.
const BATCH = {
  textMessages: 500,
  mediaMessages: 200,
  alerts: 500,
  automationRuns: 500,
  aiUsageEvents: 1000,
  conversations: 200,
};

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret") || "";
  const expected = envVar("RETENTION_CRON_SECRET");
  if (!expected || !timingSafeEqual(provided, expected)) return json({ error: "Forbidden" }, 403);

  const sb = createServiceClient();
  const results: Record<string, number> = {};

  try {
    const { data: textDeleted, error: textError } = await sb.rpc("retention_delete_eligible_text_messages", {
      p_cutoff: cutoff(730),
      p_batch_size: BATCH.textMessages,
    });
    if (textError) console.error("retention-tick: text message delete failed", textError.message);
    results.text_messages_deleted = textError ? 0 : (textDeleted as number) ?? 0;

    const media = await deleteMediaBatch(sb, cutoff(730), BATCH.mediaMessages);
    results.media_messages_deleted = media.deleted;
    results.media_storage_failures = media.storageFailed;

    const { data: alertsDeleted, error: alertsError } = await sb.rpc("retention_delete_resolved_alerts", {
      p_cutoff: cutoff(90),
      p_batch_size: BATCH.alerts,
    });
    if (alertsError) console.error("retention-tick: resolved alert delete failed", alertsError.message);
    results.resolved_alerts_deleted = alertsError ? 0 : (alertsDeleted as number) ?? 0;

    const { data: runsDeleted, error: runsError } = await sb.rpc("retention_delete_terminal_automation_runs", {
      p_cutoff: cutoff(180),
      p_batch_size: BATCH.automationRuns,
    });
    if (runsError) console.error("retention-tick: automation run delete failed", runsError.message);
    results.automation_runs_deleted = runsError ? 0 : (runsDeleted as number) ?? 0;

    const { data: usageDeleted, error: usageError } = await sb.rpc("retention_delete_old_ai_usage_events", {
      p_cutoff: cutoff(730),
      p_batch_size: BATCH.aiUsageEvents,
    });
    if (usageError) console.error("retention-tick: ai_usage_events delete failed", usageError.message);
    results.ai_usage_events_deleted = usageError ? 0 : (usageDeleted as number) ?? 0;

    const { data: convDeleted, error: convError } = await sb.rpc("retention_delete_empty_old_conversations", {
      p_cutoff: cutoff(730),
      p_batch_size: BATCH.conversations,
    });
    if (convError) console.error("retention-tick: conversation delete failed", convError.message);
    results.conversations_deleted = convError ? 0 : (convDeleted as number) ?? 0;

    return json({ ok: true, ...results });
  } catch (err) {
    console.error("retention-tick: unexpected failure", err instanceof Error ? err.message : err);
    return json({ ok: false, error: "internal_error", ...results }, 500);
  }
});

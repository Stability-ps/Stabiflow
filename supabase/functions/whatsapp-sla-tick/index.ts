// Phase 5 - WhatsApp handoff-SLA sweep worker. Cron-triggered (pg_cron ->
// pg_net, see 20260923060000), authorised by a shared secret header only -
// there is no live user session. Deliberately thin: all detection logic
// lives in the set-based public.sla_sweep() SQL function so it is one
// bounded pass, tenant-safe, and directly integration-testable. This
// function just proves the caller is the scheduler and invokes it.
//
// Phase 5 is INTERNAL operations only: this worker NEVER sends a WhatsApp
// message, touches a template, or mutates any Meta/provider resource. It
// only raises/resolves inbox_alerts and emits conversation.handoff_sla_
// overdue for the existing automation engine to act on.
import { createServiceClient, envVar } from "../_shared/contentAuth.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret") || "";
  const expected = envVar("WHATSAPP_SLA_CRON_SECRET");
  if (!expected || !timingSafeEqual(provided, expected)) {
    return json({ error: "Forbidden" }, 403);
  }

  const sb = createServiceClient();
  const { data, error } = await sb.rpc("sla_sweep");
  if (error) {
    console.error("whatsapp-sla-tick: sla_sweep failed", error.message);
    return json({ ok: false, error: error.message }, 500);
  }
  return json({ ok: true, ...(data as Record<string, unknown>) });
});

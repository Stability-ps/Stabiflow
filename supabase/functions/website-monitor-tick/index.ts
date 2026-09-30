// Website monitoring, daily via pg_cron (see
// 20261016060000_business_studio.sql). Shared-secret header, no user.
//
// For each due, enabled monitor whose workspace STILL holds the
// website_monitoring entitlement: re-scan the site and turn differences
// into PENDING proposals (origin 'monitoring'). Detected changes are never
// applied - the customer reviews, accepts or rejects them in My Business.
// A workspace whose entitlement lapsed is skipped and pushed out, not
// deleted, so monitoring resumes if they re-subscribe.
import { createServiceClient, optionalEnvVar } from "../_shared/contentAuth.ts";
import { timingSafeEqualHex } from "../_shared/billing/paystack.ts";
import { runScan } from "../_shared/businessStudio/scanRunner.ts";
import { normalizeWebsiteInput } from "../_shared/businessStudio/safeFetch.ts";

const BATCH = 10; // each scan is up to ~45s; keep a tick well inside the function limit

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get("WEBSITE_MONITOR_CRON_SECRET")?.trim();
  if (!secret || !timingSafeEqualHex(secret, req.headers.get("x-cron-secret") ?? "")) return reply({ error: "Forbidden" }, 403);

  const sb = createServiceClient();
  const apiKey = optionalEnvVar("OPENAI_API_KEY");
  const ai = apiKey ? { apiKey, model: optionalEnvVar("OPENAI_FLOW_AI_MODEL") ?? "gpt-4o-mini" } : null;
  const nowIso = new Date().toISOString();
  const { data: due } = await sb
    .from("website_monitors")
    .select("workspace_id, url, frequency_days, last_scan_id")
    .eq("enabled", true)
    .lte("next_check_at", nowIso)
    .order("next_check_at", { ascending: true })
    .limit(BATCH);

  const summary = { checked: 0, skippedNoEntitlement: 0, proposals: 0, failed: 0 };
  for (const m of (due ?? []) as { workspace_id: string; url: string; frequency_days: number; last_scan_id: string | null }[]) {
    const next = new Date(Date.now() + m.frequency_days * 86_400_000).toISOString();
    const { data: entitled } = await sb.rpc("workspace_has_entitlement", { p_workspace_id: m.workspace_id, p_key: "website_monitoring" });
    if (entitled !== true) {
      summary.skippedNoEntitlement++;
      await sb.from("website_monitors").update({ next_check_at: next }).eq("workspace_id", m.workspace_id);
      continue;
    }
    try {
      const outcome = await runScan(sb, { workspaceId: m.workspace_id, url: normalizeWebsiteInput(m.url), purpose: "monitoring", userId: null, ai, previousScanId: m.last_scan_id });
      summary.checked++;
      summary.proposals += outcome.proposalsCreated;
      if (outcome.status !== "completed") summary.failed++;
      await sb.from("website_monitors").update({ next_check_at: next, last_checked_at: nowIso, last_scan_id: outcome.scanId }).eq("workspace_id", m.workspace_id);
    } catch (e) {
      summary.failed++;
      console.error("monitor scan failed", m.workspace_id, e instanceof Error ? e.message : e);
      await sb.from("website_monitors").update({ next_check_at: next, last_checked_at: nowIso }).eq("workspace_id", m.workspace_id);
    }
  }
  return reply({ ok: true, ...summary });
});

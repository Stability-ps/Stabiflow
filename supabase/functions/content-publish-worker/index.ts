// Cron-triggered publish worker. Invoked every 5 minutes by pg_cron via
// pg_net - never invoked with a user session, so authorization is a shared
// secret header, not a JWT.
//
// Adapted from Acapolite's social-publish-worker/index.ts. The one
// structural change beyond renamed tables: auto-publish is now a
// PER-WORKSPACE decision, not a single global one. A due post is only
// claimed if BOTH the env kill switch AND that specific workspace's
// content_scheduler_settings.auto_publish_enabled are true - one
// workspace enabling automatic publishing never affects any other
// workspace's posts.
//
// Safety properties this function guarantees:
//  - Publishing requires the CONTENT_AUTO_PUBLISH_ENABLED env kill switch
//    AND the post's own workspace's auto_publish_enabled to both be true.
//  - series_id is nullable (ad-hoc posts have none): a post is only
//    excluded by its series' status when it actually HAS a series, and
//    that series is not 'active'.
//  - Each row is claimed with an atomic conditional UPDATE (status='scheduled'
//    -> 'publishing'), so two concurrent invocations can never both publish
//    the same post - the loser's UPDATE affects 0 rows.
//  - Stale claims (a worker that crashed mid-publish) are reclaimable after
//    CLAIM_STALE_MINUTES so a post can never get stuck forever.
//  - The actual per-post publish logic lives in
//    _shared/contentPublishExecution.ts, shared with content-publish-now
//    (manual "Publish now"), so there is exactly one place that calls a
//    provider.
import { claimScheduledPost, executePublish, PUBLISHABLE_POST_COLUMNS, type PublishablePost } from "../_shared/contentPublishExecution.ts";
import { computeEffectiveAutoPublish, envKillSwitchAllowsPublishing } from "../_shared/contentSchedulerSettings.ts";
import { createServiceClient, envVar, JSON_HEADERS } from "../_shared/contentAuth.ts";

const BATCH_LIMIT = 20;
const CANDIDATE_FETCH_LIMIT = 60; // over-fetch before workspace/series filtering narrows it down
const CLAIM_STALE_MINUTES = 10;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, "Cache-Control": "no-store" } });
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

type CandidateRow = PublishablePost & { series: { status: string } | null };

async function workspacesWithAutoPublishEnabled(sb: ReturnType<typeof createServiceClient>, workspaceIds: string[]): Promise<Set<string>> {
  if (!workspaceIds.length) return new Set();
  const { data } = await sb
    .from("content_scheduler_settings")
    .select("workspace_id, auto_publish_enabled")
    .in("workspace_id", Array.from(new Set(workspaceIds)))
    .eq("auto_publish_enabled", true);
  return new Set((data || []).map((row: { workspace_id: string }) => row.workspace_id));
}

async function claimDuePosts(sb: ReturnType<typeof createServiceClient>, nowIso: string, staleCutoffIso: string, workerId: string): Promise<PublishablePost[]> {
  const { data: candidates, error } = await sb
    .from("content_scheduled_posts")
    .select(`${PUBLISHABLE_POST_COLUMNS}, series:content_series(status)`)
    .eq("status", "scheduled")
    .lte("scheduled_at", nowIso)
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .limit(CANDIDATE_FETCH_LIMIT);
  if (error) throw new Error(`Unable to load due scheduled posts: ${error.message}`);

  // series_id is nullable (ad-hoc posts) - a LEFT join (the default Postgrest
  // embed) means those rows come back with series: null rather than being
  // silently excluded, which an `!inner` join (Acapolite's original, where
  // campaign_id was NOT NULL) would have done.
  const eligibleBySeries = ((candidates || []) as CandidateRow[]).filter((c) => c.series_id === null || c.series?.status === "active");
  const enabledWorkspaces = await workspacesWithAutoPublishEnabled(sb, eligibleBySeries.map((c) => c.workspace_id));
  const eligible = eligibleBySeries.filter((c) => enabledWorkspaces.has(c.workspace_id)).slice(0, BATCH_LIMIT);

  const claimed: PublishablePost[] = [];
  for (const candidate of eligible) {
    // Same atomic claim primitive content-publish-now uses: only succeeds if
    // the post is still 'scheduled' at UPDATE time, so this worker run and
    // a concurrent "Publish now" click can never both publish it.
    const claimResult = await claimScheduledPost(sb, candidate.id, workerId, nowIso);
    if (claimResult) claimed.push(claimResult);
  }

  // Recover posts stuck in "publishing" from a worker that crashed before
  // recording a result, once the stale window has passed. Not re-gated by
  // the workspace's CURRENT auto-publish toggle - finishing an
  // already-in-flight attempt is a safety net, independent of whether the
  // toggle changed since the original claim.
  const { data: staleCandidates } = await sb
    .from("content_scheduled_posts")
    .select(PUBLISHABLE_POST_COLUMNS)
    .eq("status", "publishing")
    .lt("claimed_at", staleCutoffIso)
    .limit(BATCH_LIMIT);
  for (const candidate of (staleCandidates || []) as PublishablePost[]) {
    const { data: reclaimResult } = await sb
      .from("content_scheduled_posts")
      .update({ claimed_at: nowIso, claimed_by: workerId, updated_at: nowIso })
      .eq("id", candidate.id)
      .eq("status", "publishing")
      .lt("claimed_at", staleCutoffIso)
      .select("id")
      .maybeSingle();
    if (reclaimResult) claimed.push(candidate);
  }

  return claimed;
}

Deno.serve(async (req: Request) => {
  try {
    const providedSecret = req.headers.get("x-cron-secret") || "";
    if (!timingSafeEqual(providedSecret, envVar("CONTENT_CRON_SECRET"))) {
      return json({ error: "Forbidden" }, 403);
    }

    if (!envKillSwitchAllowsPublishing()) {
      return json({ ok: true, skipped: true, reason: "env_kill_switch_disabled" });
    }

    const sb = createServiceClient();
    const now = new Date();
    const nowIso = now.toISOString();
    const staleCutoffIso = new Date(now.getTime() - CLAIM_STALE_MINUTES * 60 * 1000).toISOString();
    const workerId = crypto.randomUUID();

    const claimed = await claimDuePosts(sb, nowIso, staleCutoffIso, workerId);
    if (!claimed.length) return json({ ok: true, processed: 0 });

    let published = 0;
    let retried = 0;
    let failed = 0;
    const metaApiVersion = envVar("CONTENT_META_GRAPH_API_VERSION");

    for (const post of claimed) {
      // computeEffectiveAutoPublish's DB half was already applied when
      // building `claimed` (workspacesWithAutoPublishEnabled) - this call
      // exists to keep the "both switches independently gate this" property
      // legible at the point of use, not to re-derive it differently.
      if (!computeEffectiveAutoPublish(true, true)) continue;
      const result = await executePublish(sb, post, { triggeredBy: "system_cron", metaApiVersion });
      if (result.status === "published") published++;
      else if (result.status === "scheduled") retried++;
      else failed++;
    }

    return json({ ok: true, processed: claimed.length, published, retried, failed });
  } catch (error) {
    console.error("content-publish-worker error", error instanceof Error ? error.message : error);
    return json({ ok: false }, 500);
  }
});

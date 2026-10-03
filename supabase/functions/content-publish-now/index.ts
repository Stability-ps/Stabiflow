// Explicit "Publish now": publish exactly ONE scheduled post immediately,
// bypassing the automatic-publish switches entirely (this is a deliberate,
// single, explicit action - not related to auto-publish being on or off).
//
// Adapted from Acapolite's social-publish-now/index.ts. Authorization is
// two-step, and this is the one place in the Content module that
// deliberately does NOT run everything as the caller:
//   1. Verify the caller's OWN permission (content.publish on this exact
//      post's workspace) using their own session - this is the real
//      authorization decision.
//   2. Only after that passes, switch to the service-role client to
//      perform the claim + provider call, because resolving the
//      workspace's Meta token requires get_workspace_integration_secret(),
//      which has EXECUTE revoked from authenticated/anon by design (see
//      contentPublishExecution.ts's header comment).
//
// Safety properties, unchanged from Acapolite's design:
//  - Scoped to exactly one scheduled_post_id per request - there is no
//    "publish all due posts" code path here at all.
//  - Claims the post with the SAME atomic conditional UPDATE
//    (status='scheduled' -> 'publishing') the worker uses, so two
//    concurrent "Publish now" clicks - or a click racing the cron worker -
//    can never both publish the same post. The loser's UPDATE affects 0
//    rows and gets a 409, never a duplicate provider post.
//  - Delegates the actual provider call and outcome/DB bookkeeping to
//    _shared/contentPublishExecution.ts, the exact same code the worker
//    uses - no separate provider-calling logic.
import { claimScheduledPost, executePublish, PUBLISHABLE_POST_COLUMNS } from "../_shared/contentPublishExecution.ts";
import { bearerToken, createCallerClient, createServiceClient, envVar, getCallerUserId, hasWorkspacePermission, json } from "../_shared/contentAuth.ts";
import { assertWorkspaceActive, workspaceSuspendedBody } from "../_shared/workspaceStatus.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": req.headers.get("origin") || "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json(req, { error: "Forbidden" }, 403);
  const callerSb = createCallerClient(token);
  const actorId = await getCallerUserId(callerSb);
  if (!actorId) return json(req, { error: "Forbidden" }, 403);

  let body: { scheduled_post_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }

  const scheduledPostId = body.scheduled_post_id;
  if (typeof scheduledPostId !== "string" || !scheduledPostId) {
    return json(req, { error: "scheduled_post_id is required" }, 400);
  }

  // Read as the caller: RLS's content.view select policy means this 404s
  // for a post in a workspace the caller isn't even a member of, exactly
  // like it should.
  const { data: existing, error: fetchError } = await callerSb.from("content_scheduled_posts").select(`${PUBLISHABLE_POST_COLUMNS}`).eq("id", scheduledPostId).maybeSingle();
  if (fetchError) return json(req, { error: "Unable to load the scheduled post" }, 500);
  if (!existing) return json(req, { error: "Scheduled post not found" }, 404);

  if (!(await hasWorkspacePermission(callerSb, existing.workspace_id, "content.publish"))) {
    return json(req, { error: "Forbidden" }, 403);
  }

  const statusGate = await assertWorkspaceActive(callerSb, existing.workspace_id);
  if (!statusGate.allowed) return json(req, workspaceSuspendedBody(statusGate.status), 403);

  if (existing.status !== "scheduled") {
    return json(req, {
      error: existing.status === "published"
        ? "This post has already been published and cannot be published again."
        : `This post is not in a publishable state (current status: ${existing.status}).`,
    }, 409);
  }

  const serviceSb = createServiceClient();
  const nowIso = new Date().toISOString();
  const claimId = `manual:${actorId}:${crypto.randomUUID()}`;
  // The atomic claim: only succeeds if the post is STILL 'scheduled' at
  // UPDATE time. A concurrent second click (or the cron worker, if
  // automatic publishing were on) racing this exact moment gets null back
  // here and a 409 below - never a second provider publish.
  const claimed = await claimScheduledPost(serviceSb, scheduledPostId, claimId, nowIso);
  if (!claimed) {
    return json(req, { error: "This post was just claimed by another request (a concurrent click, or the scheduler). It was not published twice." }, 409);
  }

  const result = await executePublish(serviceSb, claimed, {
    triggeredBy: "manual_admin",
    actorUserId: actorId,
    metaApiVersion: envVar("CONTENT_META_GRAPH_API_VERSION"),
  });

  const { data: finalRow } = await serviceSb
    .from("content_scheduled_posts")
    .select("id, status, provider_post_id, provider_permalink, published_at, failure_code, failure_message, next_retry_at")
    .eq("id", scheduledPostId)
    .maybeSingle();

  return json(req, {
    ok: result.outcome.kind === "success",
    outcome: result.outcome.kind,
    status: result.status,
    post: finalRow,
  });
});

// The single place that actually calls a Meta provider and records the
// result. Both content-publish-worker (cron) and content-publish-now
// (explicit "Publish now") call executePublish for exactly one post -
// neither duplicates provider-calling logic, and both get identical
// idempotency/outcome handling.
//
// Adapted from Acapolite's _shared/socialPublishExecution.ts. The
// significant change: `sb` here MUST be a SERVICE-ROLE client.
// get_workspace_integration_secret() (how this module resolves a
// workspace's Meta token) has EXECUTE revoked from anon/authenticated by
// design (see 20260824060400_workspace_integrations.sql - "no raw Vault
// secrets returned to normal authenticated clients"), so a caller-JWT
// client can never reach it. The CALLER's actual permission to trigger a
// publish (content.publish) is verified separately, using the caller's own
// session, by the edge function BEFORE it calls this - see
// content-publish-now/index.ts for that check. This function performs no
// authorization of its own; it assumes the call already earned the right
// to happen.
import { decideNextState, type PublishOutcome } from "./contentPublishDecision.ts";
import { PermanentPublishError, TemporaryPublishError } from "./content-providers/types.ts";
import { publishToFacebookPage } from "./content-providers/meta-facebook.ts";
import { publishToInstagramAccount } from "./content-providers/meta-instagram.ts";
import { publishToLinkedInCompanyPage } from "./content-providers/linkedin.ts";

// deno-lint-ignore no-explicit-any
export type AnySupabaseClient = any;

export const CONTENT_MEDIA_BUCKET = "content-media";
const SIGNED_URL_SECONDS = 300;

export type PublishablePost = {
  id: string;
  workspace_id: string;
  series_id: string | null;
  media_asset_id: string;
  platform_variant_id: string | null;
  target_platform: string;
  facebook_page_id: string | null;
  instagram_account_id: string | null;
  caption: string;
  hashtags: string[] | null;
  attempt_count: number;
  status: string;
};

export const PUBLISHABLE_POST_COLUMNS =
  "id, workspace_id, series_id, media_asset_id, platform_variant_id, target_platform, facebook_page_id, instagram_account_id, caption, hashtags, attempt_count, status";

// The one atomic claim primitive both the cron worker and "Publish now"
// use: a conditional UPDATE that only succeeds if the post is STILL
// 'scheduled' at the moment it runs. Postgres's per-statement snapshot
// guarantees at most one concurrent caller's UPDATE actually matches, so
// two simultaneous callers (two clicks, or a click racing the worker) can
// never both come away with a claimed row - the loser gets null and must
// not publish anything.
export async function claimScheduledPost(sb: AnySupabaseClient, postId: string, claimedBy: string, nowIso: string): Promise<PublishablePost | null> {
  const { data } = await sb
    .from("content_scheduled_posts")
    .update({ status: "publishing", claimed_at: nowIso, claimed_by: claimedBy, updated_at: nowIso })
    .eq("id", postId)
    .eq("status", "scheduled")
    .select(PUBLISHABLE_POST_COLUMNS)
    .maybeSingle();
  return (data as PublishablePost) || null;
}

type ResolvedDestination = { providerAccountId: string; integrationId: string };

// Resolves which Facebook Page / Instagram account this post targets -
// re-verifying the row's own workspace_id matches, even though the
// content_scheduled_posts_validate_workspace trigger already guarantees
// this at write time. Defense in depth costs one extra comparison; a
// resolver that silently trusted the id alone would be the "Workspace A
// scheduled post resolves Workspace B's social account" bug this whole
// design exists to prevent.
async function resolveDestination(sb: AnySupabaseClient, post: PublishablePost): Promise<ResolvedDestination | null> {
  if (post.target_platform === "facebook") {
    if (!post.facebook_page_id) return null;
    const { data } = await sb
      .from("workspace_facebook_pages")
      .select("page_id, integration_id, workspace_id")
      .eq("id", post.facebook_page_id)
      .single();
    if (!data || data.workspace_id !== post.workspace_id) return null;
    return { providerAccountId: data.page_id, integrationId: data.integration_id };
  }
  if (post.target_platform === "instagram") {
    if (!post.instagram_account_id) return null;
    const { data } = await sb
      .from("workspace_instagram_accounts")
      .select("ig_business_account_id, integration_id, workspace_id")
      .eq("id", post.instagram_account_id)
      .single();
    if (!data || data.workspace_id !== post.workspace_id) return null;
    return { providerAccountId: data.ig_business_account_id, integrationId: data.integration_id };
  }
  return null;
}

export async function dispatchToProvider(
  platform: string,
  request: { imageUrl: string; caption: string; providerAccountId: string; token: string; apiVersion: string },
) {
  if (platform === "facebook") return publishToFacebookPage(request);
  if (platform === "instagram") return publishToInstagramAccount(request);
  if (platform === "linkedin") return publishToLinkedInCompanyPage(request);
  throw new PermanentPublishError("unknown_platform", `Unknown target platform: ${platform}`);
}

export type ExecutePublishOptions = {
  triggeredBy: "system_cron" | "manual_admin";
  actorUserId?: string | null;
  metaApiVersion: string;
};

export type ExecutePublishResult = {
  outcome: PublishOutcome;
  status: "published" | "scheduled" | "failed";
};

// Runs the full publish attempt for exactly one already-claimed post:
// resolve the workspace's destination + token, resolve the right image
// (variant if the target platform needed one), call the provider, decide
// the next state via the same retry/backoff rules the worker uses, then
// write content_scheduled_posts + content_publish_attempts +
// workspace_activity_log. The caller is responsible for claiming the post
// first (atomic UPDATE ... WHERE status = 'scheduled') so this function
// never has to re-derive idempotency itself.
export async function executePublish(sb: AnySupabaseClient, post: PublishablePost, options: ExecutePublishOptions): Promise<ExecutePublishResult> {
  const startedAt = new Date();
  let outcome: PublishOutcome;
  try {
    const destination = await resolveDestination(sb, post);
    if (!destination) {
      throw new PermanentPublishError("missing_destination", "The connected Facebook Page or Instagram account no longer exists for this workspace");
    }

    const { data: integration } = await sb
      .from("workspace_integrations")
      .select("id, workspace_id, status")
      .eq("id", destination.integrationId)
      .single();
    if (!integration || integration.workspace_id !== post.workspace_id || integration.status !== "connected") {
      throw new PermanentPublishError("integration_not_connected", "This workspace's Meta integration is not connected");
    }

    const { data: token, error: tokenError } = await sb.rpc("get_workspace_integration_secret", {
      p_integration_id: destination.integrationId,
    });
    if (tokenError || !token) {
      throw new TemporaryPublishError("token_unavailable", "Unable to resolve this workspace's Meta access token");
    }

    const { data: asset } = post.platform_variant_id
      ? await sb.from("content_platform_variants").select("storage_path").eq("id", post.platform_variant_id).single()
      : await sb.from("content_media_assets").select("storage_path").eq("id", post.media_asset_id).single();
    if (!asset) throw new PermanentPublishError("missing_reference", "Media asset or platform variant no longer exists");

    const { data: signed, error: signError } = await sb.storage.from(CONTENT_MEDIA_BUCKET).createSignedUrl(asset.storage_path, SIGNED_URL_SECONDS);
    if (signError || !signed?.signedUrl) throw new TemporaryPublishError("signed_url_failed", "Unable to create a signed URL for the asset");

    const hashtagText = ((post.hashtags as string[]) || []).map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" ");
    const caption = [post.caption, hashtagText].filter(Boolean).join("\n\n");

    const result = await dispatchToProvider(post.target_platform, {
      imageUrl: signed.signedUrl,
      caption,
      providerAccountId: destination.providerAccountId,
      token,
      apiVersion: options.metaApiVersion,
    });
    outcome = { kind: "success", providerPostId: result.providerPostId, permalink: result.permalink };
  } catch (error) {
    if (error instanceof TemporaryPublishError) outcome = { kind: "temporary_failure", code: error.code, message: error.message };
    else if (error instanceof PermanentPublishError) outcome = { kind: "permanent_failure", code: error.code, message: error.message };
    else outcome = { kind: "temporary_failure", code: "unexpected_error", message: error instanceof Error ? error.message : "Unknown error" };
  }

  const finishedAt = new Date();
  const next = decideNextState({ attemptCount: post.attempt_count, status: post.status }, outcome, finishedAt);

  if (next.status === "published") {
    await sb.from("content_scheduled_posts").update({
      status: "published",
      published_at: next.publishedAt.toISOString(),
      provider_post_id: next.providerPostId,
      provider_permalink: next.providerPermalink,
      attempt_count: next.attemptCount,
      last_attempt_at: finishedAt.toISOString(),
      next_retry_at: null,
      failure_code: null,
      failure_message: null,
      claimed_at: null,
      claimed_by: null,
      updated_at: finishedAt.toISOString(),
    }).eq("id", post.id);
  } else if (next.status === "scheduled") {
    await sb.from("content_scheduled_posts").update({
      status: "scheduled",
      attempt_count: next.attemptCount,
      last_attempt_at: finishedAt.toISOString(),
      next_retry_at: next.nextRetryAt.toISOString(),
      failure_code: next.failureCode,
      failure_message: next.failureMessage,
      claimed_at: null,
      claimed_by: null,
      updated_at: finishedAt.toISOString(),
    }).eq("id", post.id);
  } else {
    await sb.from("content_scheduled_posts").update({
      status: "failed",
      attempt_count: next.attemptCount,
      last_attempt_at: finishedAt.toISOString(),
      next_retry_at: null,
      failure_code: next.failureCode,
      failure_message: next.failureMessage,
      claimed_at: null,
      claimed_by: null,
      updated_at: finishedAt.toISOString(),
    }).eq("id", post.id);
  }

  await sb.from("content_publish_attempts").insert({
    workspace_id: post.workspace_id,
    scheduled_post_id: post.id,
    attempt_number: next.attemptCount,
    status: outcome.kind,
    error_code: outcome.kind === "success" ? null : outcome.code,
    error_message: outcome.kind === "success" ? null : outcome.message,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
  });

  await sb.from("workspace_activity_log").insert({
    workspace_id: post.workspace_id,
    actor_user_id: options.actorUserId ?? null,
    action: outcome.kind === "success" ? "content_post_published" : next.status === "failed" ? "content_post_publish_failed" : "content_post_publish_retry_scheduled",
    target_type: "content_scheduled_post",
    target_id: post.id,
    metadata: {
      platform: post.target_platform,
      series_id: post.series_id,
      triggered_by: options.triggeredBy,
      outcome: outcome.kind,
      code: outcome.kind === "success" ? null : outcome.code,
    },
  });

  return { outcome, status: next.status };
}

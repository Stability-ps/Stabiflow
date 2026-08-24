// Preview (dry-run), activate, or recalculate a content series' schedule -
// the optional recurring-cadence flow (a group of posts spread
// `interval_days` apart, reusing the DST-safe schedule engine). The
// primary Phase 5 creation flow is a single ad-hoc post
// (content-schedule-post); this function exists for the power-user case
// where someone wants a whole run of posts spaced automatically.
//
// Adapted from Acapolite's social-campaign-activate/index.ts:
//  - social_campaigns/social_campaign_items/social_accounts ->
//    content_series/content_series_items/workspace_facebook_pages
//    or workspace_instagram_accounts (see the naming decision in the
//    schema migration).
//  - The series' timezone now comes from workspace_settings.timezone
//    (one real per-workspace value) instead of a hardcoded per-campaign
//    default.
//  - Runs entirely as the caller (RLS is the authorization boundary),
//    same as Acapolite's original - the caller-JWT client already only
//    sees rows in workspaces they belong to, and content.create/content.edit
//    gate the actual writes.
import { computeScheduleDates, nextOccurrenceAtOrAfter } from "../_shared/contentSchedule.ts";
import { buildIdempotencyKey } from "../_shared/contentIdempotency.ts";
import { platformKeyForContentPlatform, validateAssetForPlatform } from "../_shared/contentPlatformRules.ts";
import { bearerToken, createCallerClient, getCallerUserId, hasWorkspacePermission, json, type AnySupabaseClient } from "../_shared/contentAuth.ts";

type PlatformVariantRow = { id: string; media_asset_id: string; platform: string; storage_path: string; width_px: number; height_px: number; mime_type: string; file_size_bytes: number };
type ValidationIssue = { series_item_id: string; platform: string; failures: unknown[] };

async function resolveDestination(sb: AnySupabaseClient, workspaceId: string, platform: string): Promise<{ id: string } | null> {
  if (platform === "facebook") {
    const { data } = await sb.from("workspace_facebook_pages").select("id").eq("workspace_id", workspaceId).eq("is_active", true).limit(1).maybeSingle();
    return data;
  }
  if (platform === "instagram") {
    const { data } = await sb.from("workspace_instagram_accounts").select("id").eq("workspace_id", workspaceId).eq("is_active", true).limit(1).maybeSingle();
    return data;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": req.headers.get("origin") || "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json(req, { error: "Forbidden" }, 403);
  const sb = createCallerClient(token);
  const actorId = await getCallerUserId(sb);
  if (!actorId) return json(req, { error: "Forbidden" }, 403);

  let body: { action?: string; workspace_id?: string; series_id?: string };
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }

  const action = body.action;
  const workspaceId = body.workspace_id;
  const seriesId = body.series_id;
  if (action !== "preview" && action !== "activate" && action !== "recalculate") {
    return json(req, { error: "action must be 'preview', 'activate', or 'recalculate'" }, 400);
  }
  if (!workspaceId) return json(req, { error: "workspace_id is required" }, 400);
  if (!seriesId) return json(req, { error: "series_id is required" }, 400);

  const requiredPermission = action === "preview" ? "content.view" : "content.create";
  if (!(await hasWorkspacePermission(sb, workspaceId, requiredPermission))) return json(req, { error: "Forbidden" }, 403);

  const { data: series, error: seriesError } = await sb.from("content_series").select("*").eq("id", seriesId).maybeSingle();
  if (seriesError) return json(req, { error: "Unable to load series" }, 500);
  if (!series || series.workspace_id !== workspaceId) return json(req, { error: "Series not found" }, 404);

  const { data: settings } = await sb.from("workspace_settings").select("timezone").eq("workspace_id", workspaceId).maybeSingle();
  const timezone = settings?.timezone || "Africa/Johannesburg";

  if (action === "activate" && series.status !== "approved" && series.status !== "draft") {
    return json(req, { error: `Series must be draft or approved before activation (current status: ${series.status})` }, 400);
  }

  // "Recalculate schedule" is a distinct, explicitly-opt-in action: it
  // re-spaces every not-yet-published post starting from the next
  // occurrence of the series' usual posting time. Ordinary per-post
  // reschedule (done directly against content_scheduled_posts from the UI)
  // never cascades into other posts - only this action does.
  if (action === "recalculate") {
    if (series.status !== "active" && series.status !== "paused") {
      return json(req, { error: `Only active or paused series can be recalculated (current status: ${series.status})` }, 400);
    }

    const { data: pendingRows, error: pendingError } = await sb
      .from("content_scheduled_posts")
      .select("id, media_asset_id, target_platform, facebook_page_id, instagram_account_id, scheduled_at")
      .eq("series_id", seriesId)
      .eq("status", "scheduled")
      .order("scheduled_at", { ascending: true });
    if (pendingError) return json(req, { error: "Unable to load scheduled posts" }, 500);
    if (!pendingRows?.length) return json(req, { ok: true, recalculated: 0, poster_slots: 0 });

    // Rows sharing the same scheduled_at are the same "slot" (one post
    // published to several platforms at once) - group them so the whole
    // slot moves together instead of splitting across platforms.
    const groups: (typeof pendingRows)[] = [];
    const groupIndexByInstant = new Map<string, number>();
    for (const row of pendingRows) {
      const key = new Date(row.scheduled_at).toISOString();
      let index = groupIndexByInstant.get(key);
      if (index === undefined) {
        index = groups.length;
        groupIndexByInstant.set(key, index);
        groups.push([]);
      }
      groups[index].push(row);
    }

    const { data: excludedRows } = await sb.from("content_series_excluded_dates").select("excluded_date").eq("series_id", seriesId);
    const excludedDates = (excludedRows || []).map((row: { excluded_date: string }) => String(row.excluded_date));

    const effectiveStartAt = nextOccurrenceAtOrAfter(new Date(), new Date(series.start_at), timezone);
    const slots = computeScheduleDates({
      startAt: effectiveStartAt,
      timezone,
      intervalDays: series.interval_days,
      count: groups.length,
      excludedDates,
    });

    let updatedCount = 0;
    const nowIso = new Date().toISOString();
    for (let i = 0; i < groups.length; i++) {
      const newScheduledAt = slots[i].scheduledAt;
      for (const row of groups[i]) {
        const destinationId = row.facebook_page_id || row.instagram_account_id;
        const newKey = await buildIdempotencyKey({
          workspaceId,
          seriesId,
          mediaAssetId: row.media_asset_id,
          targetPlatform: row.target_platform,
          destinationId,
          scheduledAt: newScheduledAt,
        });
        const { error: updateError } = await sb
          .from("content_scheduled_posts")
          .update({ scheduled_at: newScheduledAt.toISOString(), idempotency_key: newKey, next_retry_at: null, updated_at: nowIso })
          .eq("id", row.id);
        if (!updateError) updatedCount++;
      }
    }

    await sb.from("workspace_activity_log").insert({
      workspace_id: workspaceId,
      actor_user_id: actorId,
      action: "content_series_schedule_recalculated",
      target_type: "content_series",
      target_id: seriesId,
      metadata: { poster_slots: groups.length, posts_updated: updatedCount },
    });

    return json(req, { ok: true, recalculated: updatedCount, poster_slots: groups.length });
  }

  const { data: items, error: itemsError } = await sb
    .from("content_series_items")
    .select("id, position, caption_override, hashtags_override, media_asset:content_media_assets(id, mime_type, width_px, height_px, file_size_bytes, default_caption)")
    .eq("series_id", seriesId)
    .order("position", { ascending: true });
  if (itemsError) return json(req, { error: "Unable to load series posts" }, 500);
  if (!items?.length) return json(req, { error: "Series has no posts to schedule" }, 400);

  const { data: excludedRows } = await sb.from("content_series_excluded_dates").select("excluded_date").eq("series_id", seriesId);
  const excludedDates = (excludedRows || []).map((row: { excluded_date: string }) => String(row.excluded_date));

  const platforms = (series.target_platforms || []) as string[];
  if (!platforms.length) return json(req, { error: "Series has no target platforms selected" }, 400);

  const destinationsByPlatform = new Map<string, string>();
  for (const platform of platforms) {
    const destination = await resolveDestination(sb, workspaceId, platform);
    if (!destination) return json(req, { error: `No connected, active ${platform} destination. Connect one under Integrations first.` }, 400);
    destinationsByPlatform.set(platform, destination.id);
  }

  const slots = computeScheduleDates({
    startAt: new Date(series.start_at),
    timezone,
    intervalDays: series.interval_days,
    count: items.length,
    excludedDates,
  });

  const mediaAssetIds = items.map((item: unknown) => (item as { media_asset: { id: string } }).media_asset.id);
  const { data: variantRows } = await sb
    .from("content_platform_variants")
    .select("id, media_asset_id, platform, storage_path, width_px, height_px, mime_type, file_size_bytes")
    .in("media_asset_id", mediaAssetIds);
  const variantsByAssetPlatform = new Map<string, PlatformVariantRow>();
  for (const variant of (variantRows || []) as PlatformVariantRow[]) {
    variantsByAssetPlatform.set(`${variant.media_asset_id}:${variant.platform}`, variant);
  }

  const rows: Record<string, unknown>[] = [];
  const validationIssues: ValidationIssue[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i] as unknown as {
      id: string;
      caption_override: string | null;
      hashtags_override: string[] | null;
      media_asset: { id: string; mime_type: string; width_px: number; height_px: number; file_size_bytes: number; default_caption: string | null };
    };
    const slot = slots[i];
    const asset = item.media_asset;

    for (const platform of platforms) {
      const destinationId = destinationsByPlatform.get(platform)!;
      const platformKey = platformKeyForContentPlatform(platform);
      const originalValidation = validateAssetForPlatform(
        { mimeType: asset.mime_type, width: asset.width_px, height: asset.height_px, fileSizeBytes: asset.file_size_bytes },
        platformKey,
      );

      // The original asset is preferred whenever it already passes on its
      // own. Only fall back to a generated platform variant when it
      // doesn't - and only if that variant itself actually passes; a
      // variant existing is not itself proof it's valid (rules can change).
      let platformVariantId: string | null = null;
      let validation = originalValidation;
      if (!originalValidation.valid) {
        const variant = variantsByAssetPlatform.get(`${asset.id}:${platform}`);
        if (variant) {
          const variantValidation = validateAssetForPlatform(
            { mimeType: variant.mime_type, width: variant.width_px, height: variant.height_px, fileSizeBytes: variant.file_size_bytes },
            platformKey,
          );
          if (variantValidation.valid) {
            validation = variantValidation;
            platformVariantId = variant.id;
          }
        }
      }

      if (!validation.valid) {
        validationIssues.push({ series_item_id: item.id, platform, failures: validation.failures });
        continue;
      }

      const caption = item.caption_override || series.default_caption_template || asset.default_caption || "";
      const hashtags = item.hashtags_override || series.default_hashtags || [];
      const idempotencyKey = await buildIdempotencyKey({
        workspaceId,
        seriesId,
        mediaAssetId: asset.id,
        targetPlatform: platform,
        destinationId,
        scheduledAt: slot.scheduledAt,
      });

      rows.push({
        workspace_id: workspaceId,
        series_id: seriesId,
        series_item_id: item.id,
        media_asset_id: asset.id,
        platform_variant_id: platformVariantId,
        target_platform: platform,
        facebook_page_id: platform === "facebook" ? destinationId : null,
        instagram_account_id: platform === "instagram" ? destinationId : null,
        scheduled_at: slot.scheduledAt.toISOString(),
        caption,
        hashtags,
        idempotency_key: idempotencyKey,
        status: "scheduled",
      });
    }
  }

  if (action === "preview") {
    return json(req, { ok: true, preview: true, slots: rows, validation_issues: validationIssues });
  }

  if (validationIssues.length) {
    return json(req, { error: "Some posts fail platform validation and must be fixed or removed before activation.", validation_issues: validationIssues }, 400);
  }

  const { data: inserted, error: insertError } = await sb
    .from("content_scheduled_posts")
    .upsert(rows, { onConflict: "idempotency_key", ignoreDuplicates: true })
    .select("id");
  if (insertError) return json(req, { error: "Unable to create scheduled posts" }, 500);

  const activatedAt = new Date().toISOString();
  const { error: activateError } = await sb
    .from("content_series")
    .update({ status: "active", activated_at: activatedAt, updated_at: activatedAt })
    .eq("id", seriesId);
  if (activateError) return json(req, { error: "Scheduled posts were created, but activating the series failed. Retry activation." }, 500);

  await sb.from("workspace_activity_log").insert({
    workspace_id: workspaceId,
    actor_user_id: actorId,
    action: "content_series_activated",
    target_type: "content_series",
    target_id: seriesId,
    metadata: { post_count: items.length, platforms, scheduled_post_count: inserted?.length || 0 },
  });

  return json(req, { ok: true, activated: true, scheduled_count: inserted?.length || 0 });
});

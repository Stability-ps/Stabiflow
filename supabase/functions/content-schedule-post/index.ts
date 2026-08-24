// Creates exactly ONE content_scheduled_posts row for the primary Phase 5
// content-creation flow: choose destination, pick media, write a caption,
// choose a time, confirm. No series/campaign is required - series_id is
// left null. (The optional recurring-cadence flow goes through
// content-series-activate instead, reusing the same validation logic.)
//
// Runs entirely as the caller (RLS is the authorization boundary) except
// where it explicitly documents otherwise. Re-validates the asset (or an
// existing platform variant) against the target platform's rules
// server-side - never trusts that the client-side check the UI already
// did was actually followed, matching the "frontend checks are UX only"
// rule this whole product is built on.
import { platformKeyForContentPlatform, validateAssetForPlatform } from "../_shared/contentPlatformRules.ts";
import { buildIdempotencyKey } from "../_shared/contentIdempotency.ts";
import { bearerToken, createCallerClient, getCallerUserId, hasWorkspacePermission, json } from "../_shared/contentAuth.ts";

type RequestBody = {
  workspace_id?: string;
  target_platform?: string;
  facebook_page_id?: string;
  instagram_account_id?: string;
  media_asset_id?: string;
  caption?: string;
  hashtags?: string[];
  scheduled_at?: string;
  status?: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": req.headers.get("origin") || "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json(req, { error: "Forbidden" }, 403);
  const sb = createCallerClient(token);
  const actorId = await getCallerUserId(sb);
  if (!actorId) return json(req, { error: "Forbidden" }, 403);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }

  const { workspace_id: workspaceId, target_platform: targetPlatform, media_asset_id: mediaAssetId } = body;
  if (!workspaceId) return json(req, { error: "workspace_id is required" }, 400);
  if (targetPlatform !== "facebook" && targetPlatform !== "instagram") return json(req, { error: "target_platform must be 'facebook' or 'instagram'" }, 400);
  if (!mediaAssetId) return json(req, { error: "media_asset_id is required" }, 400);
  if (!body.scheduled_at) return json(req, { error: "scheduled_at is required" }, 400);
  const status = body.status === "draft" ? "draft" : "scheduled";

  if (!(await hasWorkspacePermission(sb, workspaceId, "content.create"))) {
    return json(req, { error: "Forbidden" }, 403);
  }

  const facebookPageId = targetPlatform === "facebook" ? body.facebook_page_id : undefined;
  const instagramAccountId = targetPlatform === "instagram" ? body.instagram_account_id : undefined;
  const destinationId = facebookPageId || instagramAccountId;
  if (!destinationId) return json(req, { error: `${targetPlatform === "facebook" ? "facebook_page_id" : "instagram_account_id"} is required for target_platform '${targetPlatform}'` }, 400);

  const { data: asset, error: assetError } = await sb
    .from("content_media_assets")
    .select("id, workspace_id, mime_type, width_px, height_px, file_size_bytes, default_caption")
    .eq("id", mediaAssetId)
    .maybeSingle();
  if (assetError) return json(req, { error: "Unable to load media asset" }, 500);
  if (!asset || asset.workspace_id !== workspaceId) return json(req, { error: "Media asset not found in this workspace" }, 404);

  const platformKey = platformKeyForContentPlatform(targetPlatform);
  const originalValidation = validateAssetForPlatform(
    { mimeType: asset.mime_type, width: asset.width_px, height: asset.height_px, fileSizeBytes: asset.file_size_bytes },
    platformKey,
  );

  let platformVariantId: string | null = null;
  let validation = originalValidation;
  if (!originalValidation.valid) {
    const { data: variant } = await sb
      .from("content_platform_variants")
      .select("id, workspace_id, mime_type, width_px, height_px, file_size_bytes")
      .eq("media_asset_id", mediaAssetId)
      .eq("platform", targetPlatform)
      .maybeSingle();
    if (variant && variant.workspace_id === workspaceId) {
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
    return json(req, { error: "This media doesn't meet the target platform's requirements yet.", failures: validation.failures }, 400);
  }

  const caption = (body.caption?.trim() || asset.default_caption || "").trim();
  if (!caption) return json(req, { error: "caption is required (and no default_caption exists on this asset)" }, 400);
  const hashtags = Array.isArray(body.hashtags) ? body.hashtags : [];
  const scheduledAt = new Date(body.scheduled_at);
  if (Number.isNaN(scheduledAt.getTime())) return json(req, { error: "scheduled_at must be a valid ISO timestamp" }, 400);

  const idempotencyKey = await buildIdempotencyKey({
    workspaceId,
    seriesId: null,
    mediaAssetId,
    targetPlatform,
    destinationId,
    scheduledAt,
  });

  const { data: inserted, error: insertError } = await sb
    .from("content_scheduled_posts")
    .insert({
      workspace_id: workspaceId,
      series_id: null,
      media_asset_id: mediaAssetId,
      platform_variant_id: platformVariantId,
      target_platform: targetPlatform,
      facebook_page_id: facebookPageId || null,
      instagram_account_id: instagramAccountId || null,
      scheduled_at: scheduledAt.toISOString(),
      caption,
      hashtags,
      status,
      idempotency_key: idempotencyKey,
    })
    .select("id, status, scheduled_at")
    .single();

  if (insertError) {
    // A conflicting idempotency key means this exact (workspace, asset,
    // platform, destination, instant) was already scheduled - surface that
    // plainly rather than a raw constraint error.
    if (insertError.code === "23505") return json(req, { error: "A post with this media, destination, and time already exists." }, 409);
    return json(req, { error: "Unable to create the scheduled post" }, 500);
  }

  await sb.from("workspace_activity_log").insert({
    workspace_id: workspaceId,
    actor_user_id: actorId,
    action: status === "draft" ? "content_draft_created" : "content_post_scheduled",
    target_type: "content_scheduled_post",
    target_id: inserted.id,
    metadata: { platform: targetPlatform, scheduled_at: inserted.scheduled_at },
  });

  return json(req, { ok: true, post: inserted });
});

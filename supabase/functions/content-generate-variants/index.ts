// Generates (or regenerates) Facebook/Instagram platform variants for one
// or more media assets. Runs entirely as the caller - RLS (media.upload
// gates writes to content_platform_variants and the content-media storage
// bucket) is the real authorization boundary, not this function.
//
// Adapted from Acapolite's social-generate-variants/index.ts: table names
// and the deps wiring changed for the workspace-scoped schema/bucket, but
// the actual generation algorithm (generateVariantsForAsset) and its
// single-vs-bulk request guard (parseGenerateVariantsRequest) are reused
// unchanged from _shared/contentVariantGeneration.ts.
import { generateVariantsForAsset, parseGenerateVariantsRequest, type GenerateVariantsDeps, type MediaAssetRecord } from "../_shared/contentVariantGeneration.ts";
import { CONTENT_MEDIA_BUCKET } from "../_shared/contentPublishExecution.ts";
import { bearerToken, createCallerClient, getCallerUserId, hasWorkspacePermission, json, type AnySupabaseClient } from "../_shared/contentAuth.ts";

function makeDeps(sb: AnySupabaseClient, workspaceId: string, actorId: string): GenerateVariantsDeps {
  return {
    async getAsset(assetId): Promise<MediaAssetRecord | null> {
      const { data } = await sb
        .from("content_media_assets")
        .select("id, workspace_id, storage_path, mime_type, width_px, height_px, file_size_bytes")
        .eq("id", assetId)
        .maybeSingle();
      if (!data || data.workspace_id !== workspaceId) return null;
      return data as MediaAssetRecord;
    },
    async getExistingVariant(assetId, platform) {
      const { data } = await sb.from("content_platform_variants").select("id, storage_path").eq("media_asset_id", assetId).eq("platform", platform).maybeSingle();
      return data || null;
    },
    async downloadOriginal(storagePath) {
      const { data, error } = await sb.storage.from(CONTENT_MEDIA_BUCKET).download(storagePath);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async uploadVariant(path, bytes, contentType) {
      const { error } = await sb.storage.from(CONTENT_MEDIA_BUCKET).upload(path, bytes, { upsert: false, contentType });
      return { error: error ? error.message : null };
    },
    async upsertVariant(row) {
      const { data, error } = await sb
        .from("content_platform_variants")
        .upsert(
          {
            media_asset_id: row.media_asset_id,
            workspace_id: row.workspace_id,
            platform: row.platform,
            storage_path: row.storage_path,
            width_px: row.width_px,
            height_px: row.height_px,
            aspect_ratio: row.aspect_ratio,
            mime_type: row.mime_type,
            file_size_bytes: row.file_size_bytes,
            transformation_metadata: row.transformation_metadata,
          },
          { onConflict: "media_asset_id,platform" },
        )
        .select("id, storage_path, width_px, height_px")
        .single();
      if (error || !data) return { error: error?.message || "Unable to save the generated variant" };
      return data;
    },
    async removeObjects(paths) {
      if (paths.length) await sb.storage.from(CONTENT_MEDIA_BUCKET).remove(paths);
    },
    async logActivity(action, targetId, metadata) {
      await sb.from("workspace_activity_log").insert({ workspace_id: workspaceId, actor_user_id: actorId, action, target_type: "content_media_asset", target_id: targetId, metadata });
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": req.headers.get("origin") || "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json(req, { error: "Forbidden" }, 403);
  const sb = createCallerClient(token);
  const actorId = await getCallerUserId(sb);
  if (!actorId) return json(req, { error: "Forbidden" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }

  const workspaceId = body.workspace_id;
  if (typeof workspaceId !== "string" || !workspaceId) return json(req, { error: "workspace_id is required" }, 400);
  if (!(await hasWorkspacePermission(sb, workspaceId, "media.upload"))) return json(req, { error: "Forbidden" }, 403);

  const parsed = parseGenerateVariantsRequest(body);
  if ("error" in parsed) return json(req, { error: parsed.error }, 400);

  const deps = makeDeps(sb, workspaceId, actorId);
  const allResults = [];
  for (const assetId of parsed.assetIds) {
    const results = await generateVariantsForAsset(deps, assetId);
    allResults.push(...results);
  }

  return json(req, { ok: true, bulk: parsed.bulk, results: allResults });
});

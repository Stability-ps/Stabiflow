// Public hosted business profile (no login). GET ?slug=acme
//
// The data comes ONLY from get_public_business_profile(), which returns
// public, non-rejected facts and nothing at all unless the profile is
// published AND the workspace still holds hosted_profile.publish. This
// function adds short-lived signed URLs for the logo and the published PDF
// (both live in private buckets - no public bucket is ever used).
import { createServiceClient } from "../_shared/contentAuth.ts";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/;

function reply(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      // Short shared cache: a newly unpublished profile disappears quickly.
      "Cache-Control": status === 200 ? "public, max-age=60" : "no-store",
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return reply(req, {});
  if (req.method !== "GET") return reply(req, { error: "Method not allowed" }, 405);
  const slug = (new URL(req.url).searchParams.get("slug") ?? "").toLowerCase();
  if (!SLUG_RE.test(slug)) return reply(req, { error: "Not found" }, 404);

  const sb = createServiceClient();
  const { data: profile, error } = await sb.rpc("get_public_business_profile", { p_slug: slug });
  if (error || !profile) return reply(req, { error: "Not found" }, 404);

  const { data: hp } = await sb.from("hosted_profiles").select("workspace_id, document_id").eq("slug", slug).eq("is_published", true).maybeSingle();
  let logoUrl: string | null = null;
  let documentUrl: string | null = null;
  if (hp) {
    const { data: identity } = await sb.from("business_identities").select("brand_profile_id").eq("workspace_id", hp.workspace_id).single();
    if (identity?.brand_profile_id) {
      const { data: bp } = await sb.from("creative_brand_profiles").select("logo_media_asset_id").eq("id", identity.brand_profile_id).eq("workspace_id", hp.workspace_id).maybeSingle();
      if (bp?.logo_media_asset_id) {
        const { data: asset } = await sb.from("content_media_assets").select("storage_path").eq("id", bp.logo_media_asset_id).eq("workspace_id", hp.workspace_id).maybeSingle();
        if (asset?.storage_path) logoUrl = (await sb.storage.from("content-media").createSignedUrl(asset.storage_path, 600)).data?.signedUrl ?? null;
      }
    }
    if (hp.document_id) {
      const { data: doc } = await sb.from("business_documents").select("storage_path, watermarked").eq("id", hp.document_id).eq("workspace_id", hp.workspace_id).maybeSingle();
      // Only an unwatermarked (paid) document is offered publicly.
      if (doc?.storage_path && !doc.watermarked) documentUrl = (await sb.storage.from("business-documents").createSignedUrl(doc.storage_path, 600, { download: true })).data?.signedUrl ?? null;
    }
  }
  return reply(req, { ok: true, profile, logoUrl, documentUrl });
});

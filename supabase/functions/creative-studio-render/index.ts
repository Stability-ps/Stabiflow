// Creative Studio batch image ads - stage 6 endpoint: the deterministic
// StabiFlow ad renderer's server side.
//
// This function NEVER calls an image-generation provider. It has two
// actions:
//   plan  - create the `rendering` creative rows for (ready concept x
//           chosen layout x chosen size), and hand the client the brand
//           kit + signed URLs of the background/logo so it can composite
//           the pixels deterministically (canvas, no screenshot tooling).
//   store - accept the rendered PNG bytes back, register them as a
//           reusable content_media_asset, and flip the creative to
//           `ready`. Also the "Edit copy -> re-render" path: it updates
//           the stored text columns and stores new pixels, with ZERO
//           image-provider calls (this file does not even import the
//           visual module).
//
// Because the exact commercial text lives in creative_studio_creatives
// columns and is the only thing the renderer draws, an AI image is never
// authoritative for a headline / price / CTA / contact / disclaimer.
import { bearerToken, createCallerClient, getCallerUserId, hasWorkspacePermission, json } from "../_shared/contentAuth.ts";
import { assertWorkspaceActive, workspaceSuspendedBody } from "../_shared/workspaceStatus.ts";
import { CONTENT_MEDIA_BUCKET } from "../_shared/contentPublishExecution.ts";
import { readPngDimensions, registerContentMediaAsset } from "../_shared/creativeStudio/mediaAssets.ts";

const LAYOUTS = new Set(["split", "full_bleed", "bold_statement", "professional_card"]);
const SIZE_DIMS: Record<string, { width: number; height: number }> = {
  "1080x1080": { width: 1080, height: 1080 },
  "1080x1350": { width: 1080, height: 1350 },
  "1080x1920": { width: 1080, height: 1920 },
};
const MAX_CREATIVES_PER_BATCH = 30;
const SIGNED_URL_SECONDS = 600;
const WORKSPACE_ASSETS_BUCKET = "workspace-assets";

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json(req, { error: "Forbidden" }, 403);
  const callerSb = createCallerClient(token);
  const actorId = await getCallerUserId(callerSb);
  if (!actorId) return json(req, { error: "Forbidden" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }

  const workspaceId = body.workspace_id;
  if (typeof workspaceId !== "string" || !workspaceId) return json(req, { error: "workspace_id is required" }, 400);
  const action = body.action === "store" ? "store" : "plan";

  if (!(await hasWorkspacePermission(callerSb, workspaceId, "content.create"))) {
    return json(req, { error: "Forbidden" }, 403);
  }
  const statusGate = await assertWorkspaceActive(callerSb, workspaceId);
  if (!statusGate.allowed) return json(req, workspaceSuspendedBody(statusGate.status), 403);

  // ---------------------------------------------------------------- plan
  if (action === "plan") {
    const batchId = body.batch_id;
    if (typeof batchId !== "string" || !batchId) return json(req, { error: "batch_id is required" }, 400);
    const layouts = (Array.isArray(body.layouts) ? body.layouts : []).filter((l): l is string => typeof l === "string" && LAYOUTS.has(l));
    const sizes = (Array.isArray(body.sizes) ? body.sizes : []).filter((s): s is string => typeof s === "string" && !!SIZE_DIMS[s]);
    if (layouts.length === 0) return json(req, { error: "Choose at least one layout" }, 400);
    if (sizes.length === 0) return json(req, { error: "Choose at least one size" }, 400);

    const { data: batch } = await callerSb
      .from("creative_studio_batches")
      .select("id, workspace_id")
      .eq("id", batchId)
      .maybeSingle();
    if (!batch || batch.workspace_id !== workspaceId) return json(req, { error: "Batch not found" }, 404);

    let conceptQuery = callerSb
      .from("creative_studio_concepts")
      .select("id, headline, supporting_text, cta, visual_media_asset_id, visual_status")
      .eq("batch_id", batchId)
      .eq("workspace_id", workspaceId)
      .eq("visual_status", "ready");
    const conceptIds = Array.isArray(body.concept_ids) ? body.concept_ids.filter((v): v is string => typeof v === "string") : null;
    if (conceptIds && conceptIds.length > 0) conceptQuery = conceptQuery.in("id", conceptIds);
    const { data: conceptsRaw } = await conceptQuery;
    const concepts = (conceptsRaw ?? []) as {
      id: string;
      headline: string;
      supporting_text: string;
      cta: string;
      visual_media_asset_id: string | null;
      visual_status: string;
    }[];
    if (concepts.length === 0) return json(req, { error: "No concepts with a ready visual to render" }, 400);

    const combos = concepts.length * layouts.length * sizes.length;
    const { count: existingCount } = await callerSb
      .from("creative_studio_creatives")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", batchId);
    if ((existingCount ?? 0) + combos > MAX_CREATIVES_PER_BATCH) {
      return json(req, { error: `That would exceed the ${MAX_CREATIVES_PER_BATCH}-creative limit for one batch. Pick fewer concepts, layouts or sizes.` }, 400);
    }

    await callerSb.from("creative_studio_batches").update({ layouts, sizes, status: "generating" }).eq("id", batchId);

    const rows: Record<string, unknown>[] = [];
    for (const c of concepts) {
      for (const layout of layouts) {
        for (const size of sizes) {
          const dims = SIZE_DIMS[size];
          rows.push({
            batch_id: batchId,
            concept_id: c.id,
            workspace_id: workspaceId,
            layout,
            size,
            width_px: dims.width,
            height_px: dims.height,
            headline: c.headline,
            body_text: c.supporting_text,
            cta: c.cta,
            status: "rendering",
          });
        }
      }
    }
    // Idempotent: unique (batch_id, concept_id, layout, size).
    const { error: upsertErr } = await callerSb
      .from("creative_studio_creatives")
      .upsert(rows, { onConflict: "batch_id,concept_id,layout,size", ignoreDuplicates: true });
    if (upsertErr) {
      console.error("creative-studio-render: creative upsert failed", upsertErr.message);
      return json(req, { error: "Could not prepare the render plan." }, 500);
    }

    const { data: creatives } = await callerSb
      .from("creative_studio_creatives")
      .select("*")
      .eq("batch_id", batchId)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true });

    // Brand kit.
    const [{ data: ws }, { data: settings }] = await Promise.all([
      callerSb.from("workspaces").select("name").eq("id", workspaceId).maybeSingle(),
      callerSb
        .from("workspace_settings")
        .select("brand_primary_color, brand_accent_color, brand_cta_text_color, ad_footer_disclaimer, logo_path, contact_email, contact_phone, website")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
    ]);

    let logoUrl: string | null = null;
    if (settings?.logo_path) {
      const { data: signed } = await callerSb.storage.from(WORKSPACE_ASSETS_BUCKET).createSignedUrl(settings.logo_path, SIGNED_URL_SECONDS);
      logoUrl = signed?.signedUrl ?? null;
    }

    // Signed URL for each concept's background visual.
    const assetIds = [...new Set(concepts.map((c) => c.visual_media_asset_id).filter(Boolean))] as string[];
    const visualUrls: Record<string, string> = {};
    if (assetIds.length > 0) {
      const { data: assets } = await callerSb
        .from("content_media_assets")
        .select("id, storage_path, workspace_id")
        .in("id", assetIds)
        .eq("workspace_id", workspaceId);
      for (const a of (assets ?? []) as { id: string; storage_path: string }[]) {
        const { data: signed } = await callerSb.storage.from(CONTENT_MEDIA_BUCKET).createSignedUrl(a.storage_path, SIGNED_URL_SECONDS);
        if (signed?.signedUrl) visualUrls[a.id] = signed.signedUrl;
      }
    }
    const conceptVisual: Record<string, string | null> = {};
    for (const c of concepts) {
      conceptVisual[c.id] = c.visual_media_asset_id ? visualUrls[c.visual_media_asset_id] ?? null : null;
    }

    return json(req, {
      ok: true,
      creatives: creatives ?? [],
      brand: {
        name: ws?.name ?? "",
        primary: settings?.brand_primary_color ?? null,
        accent: settings?.brand_accent_color ?? null,
        ctaText: settings?.brand_cta_text_color ?? null,
        footerDisclaimer: settings?.ad_footer_disclaimer ?? null,
        contactEmail: settings?.contact_email ?? null,
        contactPhone: settings?.contact_phone ?? null,
        website: settings?.website ?? null,
        logoUrl,
      },
      conceptVisualUrls: conceptVisual,
    });
  }

  // --------------------------------------------------------------- store
  const creativeId = body.creative_id;
  if (typeof creativeId !== "string" || !creativeId) return json(req, { error: "creative_id is required" }, 400);

  const { data: creative } = await callerSb
    .from("creative_studio_creatives")
    .select("*")
    .eq("id", creativeId)
    .maybeSingle();
  if (!creative || creative.workspace_id !== workspaceId) return json(req, { error: "Creative not found" }, 404);

  // Optional copy edit (Edit copy -> re-render). Pure text, no image call.
  const copy = body.copy && typeof body.copy === "object" ? (body.copy as Record<string, unknown>) : null;
  const textPatch: Record<string, unknown> = {};
  if (copy) {
    if (typeof copy.headline === "string" && copy.headline.trim()) textPatch.headline = copy.headline.trim().slice(0, 200);
    if (typeof copy.body_text === "string" && copy.body_text.trim()) textPatch.body_text = copy.body_text.trim().slice(0, 600);
    if (typeof copy.cta === "string" && copy.cta.trim()) textPatch.cta = copy.cta.trim().slice(0, 60);
    for (const k of ["contact_text", "price_text", "disclaimer_text"] as const) {
      if (k in copy) {
        const v = copy[k];
        textPatch[k] = typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : null;
      }
    }
  }

  const pngBase64 = body.png_base64;
  if (typeof pngBase64 !== "string" || !pngBase64) {
    return json(req, { error: "png_base64 is required" }, 400);
  }
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(pngBase64);
  } catch {
    return json(req, { error: "png_base64 is not valid base64" }, 400);
  }
  const dims = readPngDimensions(bytes);
  if (!dims) return json(req, { error: "Rendered image is not a readable PNG" }, 400);
  if (dims.width !== creative.width_px || dims.height !== creative.height_px) {
    return json(req, { error: `Rendered image is ${dims.width}x${dims.height}, expected ${creative.width_px}x${creative.height_px}` }, 400);
  }
  if (bytes.byteLength > 12 * 1024 * 1024) {
    return json(req, { error: "Rendered image is too large" }, 400);
  }

  let asset;
  try {
    asset = await registerContentMediaAsset(callerSb, {
      workspaceId,
      bytes,
      storagePath: `${workspaceId}/creative-studio/ads/${creativeId}-${creative.layout}-${creative.size}-${Date.now()}.png`,
      title: `Ad — ${textPatch.headline ?? creative.headline}`.slice(0, 200),
      createdBy: actorId,
      width: dims.width,
      height: dims.height,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await callerSb
      .from("creative_studio_creatives")
      .update({ status: "failed", render_error: message.slice(0, 500) })
      .eq("id", creativeId);
    return json(req, { error: "Could not store the rendered advert." }, 500);
  }

  const { data: updated, error: updErr } = await callerSb
    .from("creative_studio_creatives")
    .update({
      ...textPatch,
      status: "ready",
      render_error: null,
      overflow_warning: body.overflow_warning === true,
      rendered_media_asset_id: asset.id,
      storage_path: asset.storage_path,
      // A re-render resets an approve/reject decision - the reviewer
      // approved different pixels.
      reviewed_by: null,
      reviewed_at: null,
    })
    .eq("id", creativeId)
    .select("*")
    .single();
  if (updErr || !updated) return json(req, { error: "Could not finalise the creative." }, 500);

  // Roll the batch up: ready if every creative is ready/approved.
  const { data: siblings } = await callerSb
    .from("creative_studio_creatives")
    .select("status")
    .eq("batch_id", creative.batch_id)
    .eq("workspace_id", workspaceId);
  const rows = (siblings ?? []) as { status: string }[];
  const anyRendering = rows.some((r) => r.status === "rendering");
  const anyFailed = rows.some((r) => r.status === "failed");
  const anyReady = rows.some((r) => r.status === "ready" || r.status === "approved");
  const batchStatus = anyRendering ? "generating" : anyFailed ? (anyReady ? "partial" : "failed") : "ready";
  await callerSb.from("creative_studio_batches").update({ status: batchStatus }).eq("id", creative.batch_id);

  return json(req, { ok: true, creative: updated, batch: { id: creative.batch_id, status: batchStatus } });
});

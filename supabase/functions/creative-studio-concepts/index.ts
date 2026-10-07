// Creative Studio batch image ads - stage 2 endpoint: brief (+ the copy
// the user already generated) -> a batch row + structured visual concept
// rows. Same auth / permission / workspace-status gates as
// creative-studio-generate. The OpenAI call is the same single-shot
// Responses API shape; this function persists the result (unlike
// creative-studio-generate, which only returns text).
import {
  applyCopyOverrides,
  clampConceptCount,
  generateVisualConcepts,
  type ConceptCopySeed,
  type ConceptStudioInput,
} from "../_shared/creativeStudio/generateConcepts.ts";
import {
  analyzeReferenceStyle,
  buildReferenceGuidanceText,
  isReferenceImageEligible,
  shouldAnalyzeReference,
  type ReferencePreferences,
  type ReferenceStyle,
} from "../_shared/creativeStudio/analyzeReference.ts";
import { toDataUrl } from "../_shared/inbox/multimodalMedia.ts";
import { CONTENT_MEDIA_BUCKET } from "../_shared/contentPublishExecution.ts";
import { bearerToken, createCallerClient, createServiceClient, getCallerUserId, hasWorkspacePermission, json } from "../_shared/contentAuth.ts";
import { assertWorkspaceActive, workspaceSuspendedBody } from "../_shared/workspaceStatus.ts";
import { parseContactFields, resolveBrandSnapshot } from "../_shared/creativeStudio/brandSnapshot.ts";

const ASSET_PURPOSES = new Set(["reference_creative", "product_image", "background"]);

function parseReferencePreferences(v: unknown): ReferencePreferences {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return {
    keep_colours: o.keep_colours === true,
    keep_layout: o.keep_layout === true,
    keep_imagery: o.keep_imagery === true,
    fresh_layout: o.fresh_layout === true,
  };
}

function str(v: unknown, max: number): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
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

  const businessContext = typeof body.business_context === "string" ? body.business_context.trim() : "";
  if (!businessContext) return json(req, { error: "business_context is required" }, 400);
  if (businessContext.length > 1000) return json(req, { error: "business_context is too long (max 1000 characters)" }, 400);

  if (!(await hasWorkspacePermission(callerSb, workspaceId, "content.create"))) {
    return json(req, { error: "Forbidden" }, 403);
  }

  // Plan/feature access is authoritative server-side, not just the route
  // FeatureGate (same evaluator as the UI). Checked before any allowance is
  // charged or provider called.
  const { data: creativeStudioEnabled, error: featureError } = await callerSb.rpc("is_feature_enabled", {
    p_workspace_id: workspaceId,
    p_flag_key: "module.creative_studio",
  });
  if (featureError) return json(req, { error: "Forbidden" }, 403);
  if (creativeStudioEnabled !== true) {
    return json(req, { error: "Creative Studio is part of the Growth plan. Upgrade in Billing & plans to use it.", code: "MODULE_NOT_IN_PLAN" }, 403);
  }

  const statusGate = await assertWorkspaceActive(callerSb, workspaceId);
  if (!statusGate.allowed) return json(req, workspaceSuspendedBody(statusGate.status), 403);

  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim();
  const model = Deno.env.get("OPENAI_FLOW_AI_MODEL")?.trim();
  if (!apiKey || !model) {
    console.error("creative-studio-concepts: OPENAI_API_KEY/OPENAI_FLOW_AI_MODEL not configured");
    return json(req, { error: "Creative Studio is not configured yet. Contact support." }, 503);
  }

  const audience = str(body.audience, 300);
  const tone = str(body.tone, 100);
  const sourceMediaAssetId = typeof body.source_media_asset_id === "string" && body.source_media_asset_id ? body.source_media_asset_id : null;
  const conceptCount = clampConceptCount(typeof body.concept_count === "number" ? body.concept_count : 4);

  let copySeeds: ConceptCopySeed[] | undefined;
  if (Array.isArray(body.copy_variants)) {
    copySeeds = body.copy_variants
      .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
      .map((v) => ({
        headline: String(v.headline ?? ""),
        primaryText: String(v.primaryText ?? v.primary_text ?? ""),
        description: String(v.description ?? ""),
        cta: String(v.cta ?? ""),
      }))
      .filter((s) => s.headline || s.primaryText);
    if (copySeeds.length === 0) copySeeds = undefined;
  }

  // asset_purpose is how THIS generation wants to use the attached asset -
  // it is independent of the asset's own (optional, nullable) Media
  // Library asset_role classification. An unclassified asset (asset_role
  // IS NULL, true for most existing Media Library items) can still be
  // used as a reference: asset_role is reusable metadata/a UI hint, never
  // an eligibility gate (clarification #1 on the approved plan).
  const rawPurpose = typeof body.asset_purpose === "string" ? body.asset_purpose : null;
  const assetPurpose = rawPurpose && ASSET_PURPOSES.has(rawPurpose) ? (rawPurpose as "reference_creative" | "product_image" | "background") : null;
  const referencePreferences = parseReferencePreferences(body.reference_preferences);
  const visualDirection = str(body.visual_direction, 500);

  // brand_profile_id is optional - omitting it means "use this
  // workspace's legacy Brand Kit" (instruction #6 compatibility path).
  const brandProfileId = typeof body.brand_profile_id === "string" && body.brand_profile_id ? body.brand_profile_id : null;
  const brandResolution = await resolveBrandSnapshot(callerSb, workspaceId, brandProfileId);
  if ("error" in brandResolution) return json(req, { error: brandResolution.error }, 400);
  const { snapshot: brandSnapshot, resolvedProfileId } = brandResolution;

  // User-supplied campaign text (instruction #9): authoritative over
  // whatever the AI generates. Applied to every concept verbatim after
  // generation, below - the AI still writes conceptName/visualPrompt/
  // layoutStyle/visualNotes even when copy is fully user-supplied,
  // because those describe the VISUAL, not the campaign text.
  const rawUserCopy = body.user_copy && typeof body.user_copy === "object" ? (body.user_copy as Record<string, unknown>) : null;
  const userHeadline = str(rawUserCopy?.headline, 120);
  const userBodyText = str(rawUserCopy?.body, 400);
  const userCta = str(rawUserCopy?.cta, 40);

  const contactFields = parseContactFields(body.contact_fields);

  // If a source media asset was named, make sure it's this workspace's -
  // select the columns reference analysis needs so there is no second
  // round-trip when asset_purpose is reference_creative.
  let sourceAsset: { id: string; workspace_id: string; storage_path: string; mime_type: string; file_size_bytes: number } | null = null;
  if (sourceMediaAssetId) {
    const { data: asset } = await callerSb
      .from("content_media_assets")
      .select("id, workspace_id, storage_path, mime_type, file_size_bytes")
      .eq("id", sourceMediaAssetId)
      .maybeSingle();
    if (!asset || asset.workspace_id !== workspaceId) {
      return json(req, { error: "source_media_asset_id not found in this workspace" }, 400);
    }
    sourceAsset = asset;
  }

  // -- Reference-style analysis: at most ONE vision call per batch, only
  // when the caller actually asked to use the asset as a reference. A
  // failure here degrades gracefully to "no reference guidance" rather
  // than blocking copy/concept generation (same posture as the rest of
  // Creative Studio's optional AI enrichments).
  const analyzeReference =
    !!sourceAsset &&
    shouldAnalyzeReference({
      purpose: assetPurpose,
      sourceMediaAssetId: sourceAsset.id,
      existingReferenceStyle: null,
      existingReferenceSourceAssetId: null,
    });
  if (sourceAsset && analyzeReference) {
    const eligibility = isReferenceImageEligible(sourceAsset.mime_type, sourceAsset.file_size_bytes);
    if (!eligibility.eligible) {
      return json(req, { error: eligibility.reason }, 400);
    }
  }

  // Reserve one monthly Creative Studio generation before any provider call,
  // after every request check, so a rejected request never costs a
  // generation. consume_entitlement is atomic, so concurrent requests cannot
  // race past the plan allowance. Any failure after this point refunds it.
  const serviceSb = createServiceClient();
  const { data: creativeAllowed, error: creativeQuotaError } = await serviceSb.rpc("consume_entitlement", {
    p_workspace_id: workspaceId,
    p_key: "creative_generations",
    p_amount: 1,
  });
  if (creativeQuotaError) {
    console.error("creative-studio-concepts: quota check failed", creativeQuotaError.message);
    return json(req, { error: "Unable to verify your Creative Studio allowance. Try again shortly." }, 503);
  }
  if (creativeAllowed !== true) {
    return json(req, { error: "Monthly Creative Studio generation limit reached. Upgrade your plan or wait for the next monthly reset.", code: "USAGE_LIMIT_REACHED" }, 429);
  }

  const refundGeneration = async () => {
    const { error } = await serviceSb.rpc("refund_entitlement", { p_workspace_id: workspaceId, p_key: "creative_generations", p_amount: 1 });
    if (error) console.error("creative-studio-concepts: refund failed", error.message);
  };

  let referenceStyle: ReferenceStyle | null = null;
  if (sourceAsset && analyzeReference) {
    try {
      const { data: bytes, error: downloadErr } = await callerSb.storage.from(CONTENT_MEDIA_BUCKET).download(sourceAsset.storage_path);
      if (downloadErr || !bytes) throw new Error(downloadErr?.message ?? "download failed");
      const dataUrl = toDataUrl(sourceAsset.mime_type, new Uint8Array(await bytes.arrayBuffer()));
      referenceStyle = await analyzeReferenceStyle({ apiKey, model }, dataUrl);
    } catch (err) {
      console.error("creative-studio-concepts: reference analysis failed, continuing without it", err instanceof Error ? err.message : err);
      referenceStyle = null;
    }
  }

  const referenceGuidance = referenceStyle ? buildReferenceGuidanceText(referenceStyle, referencePreferences) : undefined;
  const input: ConceptStudioInput = { businessContext, audience, tone, conceptCount, copySeeds, referenceGuidance, visualDirection };

  let concepts;
  try {
    concepts = await generateVisualConcepts({ apiKey, model }, input);
    concepts = applyCopyOverrides(concepts, { headline: userHeadline, body: userBodyText, cta: userCta });
  } catch (err) {
    console.error("creative-studio-concepts: generation failed", err instanceof Error ? err.message : err);
    await refundGeneration();
    return json(req, { error: "Unable to generate visual concepts right now. Try again shortly. No generation was used." }, 502);
  }

  const { data: batch, error: batchErr } = await callerSb
    .from("creative_studio_batches")
    .insert({
      workspace_id: workspaceId,
      status: "draft",
      business_context: businessContext,
      audience: audience ?? null,
      tone: tone ?? null,
      source_media_asset_id: sourceMediaAssetId,
      reference_style: referenceStyle,
      reference_preferences: referenceStyle ? referencePreferences : null,
      brand_profile_id: resolvedProfileId,
      brand_snapshot: brandSnapshot,
      visual_direction: visualDirection ?? null,
      user_headline: userHeadline ?? null,
      user_body_text: userBodyText ?? null,
      user_cta: userCta ?? null,
      contact_fields: contactFields,
      created_by: actorId,
    })
    .select("*")
    .single();
  if (batchErr || !batch) {
    console.error("creative-studio-concepts: batch insert failed", batchErr?.message);
    await refundGeneration();
    return json(req, { error: "Could not start a creative batch." }, 500);
  }

  // concepts already carries user-authoritative text overrides (instruction
  // #9), applied verbatim to every concept just above via
  // applyCopyOverrides() - visual variety across concepts is preserved,
  // campaign text is not.
  const conceptRows = concepts.map((c, i) => ({
    batch_id: batch.id,
    workspace_id: workspaceId,
    sort_order: i,
    concept_name: c.conceptName.slice(0, 160),
    headline: c.headline.slice(0, 120),
    supporting_text: c.supportingText.slice(0, 400),
    cta: c.cta.slice(0, 40),
    visual_prompt: c.visualPrompt.slice(0, 2000),
    layout_style: c.layoutStyle.slice(0, 60),
    visual_notes: c.visualNotes.slice(0, 600),
    visual_source: "ai" as const,
    visual_status: "pending" as const,
  }));

  const { data: inserted, error: conceptErr } = await callerSb
    .from("creative_studio_concepts")
    .insert(conceptRows)
    .select("*");
  if (conceptErr || !inserted) {
    console.error("creative-studio-concepts: concept insert failed", conceptErr?.message);
    await callerSb.from("creative_studio_batches").delete().eq("id", batch.id);
    await refundGeneration();
    return json(req, { error: "Could not save the generated concepts." }, 500);
  }

  return json(req, { ok: true, batch, concepts: inserted });
});

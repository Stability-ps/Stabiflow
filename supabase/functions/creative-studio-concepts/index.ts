// Creative Studio batch image ads - stage 2 endpoint: brief (+ the copy
// the user already generated) -> a batch row + structured visual concept
// rows. Same auth / permission / workspace-status gates as
// creative-studio-generate. The OpenAI call is the same single-shot
// Responses API shape; this function persists the result (unlike
// creative-studio-generate, which only returns text).
import {
  clampConceptCount,
  generateVisualConcepts,
  type ConceptCopySeed,
  type ConceptStudioInput,
} from "../_shared/creativeStudio/generateConcepts.ts";
import { bearerToken, createCallerClient, getCallerUserId, hasWorkspacePermission, json } from "../_shared/contentAuth.ts";
import { assertWorkspaceActive, workspaceSuspendedBody } from "../_shared/workspaceStatus.ts";

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

  // If a source media asset was named, make sure it's this workspace's.
  if (sourceMediaAssetId) {
    const { data: asset } = await callerSb
      .from("content_media_assets")
      .select("id, workspace_id")
      .eq("id", sourceMediaAssetId)
      .maybeSingle();
    if (!asset || asset.workspace_id !== workspaceId) {
      return json(req, { error: "source_media_asset_id not found in this workspace" }, 400);
    }
  }

  const input: ConceptStudioInput = { businessContext, audience, tone, conceptCount, copySeeds };

  let concepts;
  try {
    concepts = await generateVisualConcepts({ apiKey, model }, input);
  } catch (err) {
    console.error("creative-studio-concepts: generation failed", err instanceof Error ? err.message : err);
    return json(req, { error: "Unable to generate visual concepts right now. Try again shortly." }, 502);
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
      created_by: actorId,
    })
    .select("*")
    .single();
  if (batchErr || !batch) {
    console.error("creative-studio-concepts: batch insert failed", batchErr?.message);
    return json(req, { error: "Could not start a creative batch." }, 500);
  }

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
    return json(req, { error: "Could not save the generated concepts." }, 500);
  }

  return json(req, { ok: true, batch, concepts: inserted });
});

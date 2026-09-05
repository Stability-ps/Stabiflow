// Creative Studio batch image ads - stage 3 endpoint: generate the AI
// background visual for each concept in a batch. ONE image-generation
// call per concept (never per finished creative). Partial failure is
// first-class: a concept that fails is marked failed with its error and
// left retryable; the successful ones are kept and the batch goes
// `partial`, never discarded.
//
// Idempotency: each concept is claimed with an atomic status CAS
// (pending/failed -> generating) before any provider call, so a
// double-clicked "Generate visuals" or an accidental re-POST can never
// start a second job for the same concept.
import { bearerToken, createCallerClient, createServiceClient, getCallerUserId, hasWorkspacePermission, json } from "../_shared/contentAuth.ts";
import { assertWorkspaceActive, workspaceSuspendedBody } from "../_shared/workspaceStatus.ts";
import { generateVisual } from "../_shared/creativeStudio/generateVisual.ts";
import { recordAdCreativeUsage, registerContentMediaAsset } from "../_shared/creativeStudio/mediaAssets.ts";

type ConceptRow = {
  id: string;
  workspace_id: string;
  concept_name: string;
  visual_prompt: string;
  visual_source: "ai" | "media_library";
  visual_status: "pending" | "generating" | "ready" | "failed";
  visual_media_asset_id: string | null;
};

function computeBatchStatus(rows: { visual_status: string }[]): "ready" | "partial" | "failed" {
  const ready = rows.filter((r) => r.visual_status === "ready").length;
  const failed = rows.filter((r) => r.visual_status === "failed").length;
  if (failed === 0) return "ready";
  if (ready > 0) return "partial";
  return "failed";
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
  const batchId = body.batch_id;
  if (typeof workspaceId !== "string" || !workspaceId) return json(req, { error: "workspace_id is required" }, 400);
  if (typeof batchId !== "string" || !batchId) return json(req, { error: "batch_id is required" }, 400);
  const retry = body.retry === true;
  const conceptIds = Array.isArray(body.concept_ids) ? body.concept_ids.filter((v): v is string => typeof v === "string") : null;

  if (!(await hasWorkspacePermission(callerSb, workspaceId, "content.create"))) {
    return json(req, { error: "Forbidden" }, 403);
  }
  const statusGate = await assertWorkspaceActive(callerSb, workspaceId);
  if (!statusGate.allowed) return json(req, workspaceSuspendedBody(statusGate.status), 403);

  const { data: batch } = await callerSb
    .from("creative_studio_batches")
    .select("id, workspace_id")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch || batch.workspace_id !== workspaceId) return json(req, { error: "Batch not found" }, 404);

  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim();
  if (!apiKey) {
    console.error("creative-studio-visuals: OPENAI_API_KEY not configured");
    return json(req, { error: "Creative Studio is not configured yet. Contact support." }, 503);
  }
  const imageModel = Deno.env.get("OPENAI_IMAGE_MODEL")?.trim() || "gpt-image-1";

  let conceptQuery = callerSb
    .from("creative_studio_concepts")
    .select("id, workspace_id, concept_name, visual_prompt, visual_source, visual_status, visual_media_asset_id")
    .eq("batch_id", batchId)
    .eq("workspace_id", workspaceId);
  if (conceptIds && conceptIds.length > 0) conceptQuery = conceptQuery.in("id", conceptIds);
  const { data: concepts, error: conceptErr } = await conceptQuery;
  if (conceptErr) return json(req, { error: "Could not load concepts" }, 500);
  if (!concepts || concepts.length === 0) return json(req, { error: "No concepts to generate" }, 400);

  await callerSb.from("creative_studio_batches").update({ status: "generating", error_detail: null }).eq("id", batchId);

  const serviceSb = createServiceClient();
  const claimableStatuses = retry ? ["pending", "failed"] : ["pending"];
  const results: { id: string; visual_status: string; visual_error: string | null }[] = [];

  for (const concept of concepts as ConceptRow[]) {
    // Media Library source: no AI call - ready iff an asset is attached.
    if (concept.visual_source === "media_library") {
      const ok = !!concept.visual_media_asset_id;
      await callerSb
        .from("creative_studio_concepts")
        .update({ visual_status: ok ? "ready" : "failed", visual_error: ok ? null : "No Media Library image attached to this concept" })
        .eq("id", concept.id);
      results.push({ id: concept.id, visual_status: ok ? "ready" : "failed", visual_error: ok ? null : "No Media Library image attached" });
      continue;
    }

    // Atomic claim. 0 rows -> already claimed / already done -> skip.
    const { data: claimed } = await callerSb
      .from("creative_studio_concepts")
      .update({ visual_status: "generating", visual_job_id: crypto.randomUUID(), visual_error: null })
      .eq("id", concept.id)
      .eq("workspace_id", workspaceId)
      .in("visual_status", claimableStatuses)
      .select("id");
    if (!claimed || claimed.length === 0) {
      results.push({ id: concept.id, visual_status: concept.visual_status, visual_error: null });
      continue;
    }

    const startedAt = Date.now();
    try {
      const visual = await generateVisual({ apiKey, model: imageModel }, concept.visual_prompt);
      const asset = await registerContentMediaAsset(callerSb, {
        workspaceId,
        bytes: visual.bytes,
        storagePath: `${workspaceId}/creative-studio/visuals/${concept.id}-${Date.now()}.png`,
        title: `AI visual — ${concept.concept_name}`,
        createdBy: actorId,
        mimeType: visual.mimeType,
        width: visual.width,
        height: visual.height,
      });
      await callerSb
        .from("creative_studio_concepts")
        .update({ visual_status: "ready", visual_media_asset_id: asset.id, visual_error: null })
        .eq("id", concept.id);
      await recordAdCreativeUsage(serviceSb, {
        workspaceId,
        userId: actorId,
        model: imageModel,
        inputTokens: visual.usage?.inputTokens ?? 0,
        outputTokens: visual.usage?.outputTokens ?? 0,
        latencyMs: Date.now() - startedAt,
        status: "success",
      });
      results.push({ id: concept.id, visual_status: "ready", visual_error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await callerSb
        .from("creative_studio_concepts")
        .update({ visual_status: "failed", visual_error: message.slice(0, 500) })
        .eq("id", concept.id);
      await recordAdCreativeUsage(serviceSb, {
        workspaceId,
        userId: actorId,
        model: imageModel,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - startedAt,
        status: "error",
      });
      results.push({ id: concept.id, visual_status: "failed", visual_error: message.slice(0, 500) });
    }
  }

  // Recompute batch status across ALL concepts in the batch.
  const { data: allConceptsRaw } = await callerSb
    .from("creative_studio_concepts")
    .select("visual_status")
    .eq("batch_id", batchId)
    .eq("workspace_id", workspaceId);
  const allConcepts = (allConceptsRaw ?? []) as { visual_status: string }[];
  const batchStatus = computeBatchStatus(allConcepts);
  await callerSb.from("creative_studio_batches").update({ status: batchStatus }).eq("id", batchId);

  const summary = {
    ready: allConcepts.filter((r) => r.visual_status === "ready").length,
    failed: allConcepts.filter((r) => r.visual_status === "failed").length,
    total: allConcepts.length,
  };
  return json(req, { ok: true, batch: { id: batchId, status: batchStatus }, concepts: results, summary });
});

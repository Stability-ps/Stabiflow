// Creative Studio V1 (post-launch UI polish). Generates ad copy
// variations (headline/primary text/description/CTA) via the same
// single-shot OpenAI Responses API call already proven for WhatsApp AI
// (_shared/inbox/aiReplyEngine.ts) - see
// _shared/creativeStudio/generateCopy.ts's header comment for why this is
// deliberately NOT Flow AI's streaming/tool-calling architecture.
//
// This function only generates text and returns it to the caller - it
// never writes to any table itself. Saving a variation into a Media
// Library asset's caption, or using it to prefill a new campaign, are
// separate, explicit, already-existing client-side actions the user
// triggers themselves (the same content.create-gated update path Media
// Library editing already uses, and the same /campaigns/new prefill
// mechanism MediaLibraryGrid's "Promote as Campaign" button already
// uses) - no new mutation surface was added for this feature.
import { generateCreativeCopy, type CreativeStudioInput } from "../_shared/creativeStudio/generateCopy.ts";
import { bearerToken, createCallerClient, createServiceClient, getCallerUserId, hasWorkspacePermission, json } from "../_shared/contentAuth.ts";
import { assertWorkspaceActive, workspaceSuspendedBody } from "../_shared/workspaceStatus.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": req.headers.get("origin") || "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json(req, { error: "Forbidden" }, 403);
  const callerSb = createCallerClient(token);
  const actorId = await getCallerUserId(callerSb);
  if (!actorId) return json(req, { error: "Forbidden" }, 403);

  let body: { workspace_id?: unknown; business_context?: unknown; audience?: unknown; tone?: unknown; variant_count?: unknown };
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

  // Content-creation-tier permission (owner/admin/manager/marketing) -
  // this is fundamentally "help me write content/campaign copy", the
  // same bar Content module creation already uses. No new permission
  // introduced.
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
    console.error("creative-studio-generate: OPENAI_API_KEY/OPENAI_FLOW_AI_MODEL not configured");
    return json(req, { error: "Creative Studio is not configured yet. Contact support." }, 503);
  }

  // Reserve one monthly Creative Studio generation before the provider call,
  // after the configuration check, so a request that cannot run never costs
  // a generation. consume_entitlement is atomic, so concurrent requests
  // cannot race past the plan allowance. A failed generation refunds it.
  const serviceSb = createServiceClient();
  const { data: creativeAllowed, error: creativeQuotaError } = await serviceSb.rpc("consume_entitlement", {
    p_workspace_id: workspaceId,
    p_key: "creative_generations",
    p_amount: 1,
  });
  if (creativeQuotaError) {
    console.error("creative-studio-generate: quota check failed", creativeQuotaError.message);
    return json(req, { error: "Unable to verify your Creative Studio allowance. Try again shortly." }, 503);
  }
  if (creativeAllowed !== true) {
    return json(req, { error: "Monthly Creative Studio generation limit reached. Upgrade your plan or wait for the next monthly reset.", code: "USAGE_LIMIT_REACHED" }, 429);
  }

  const input: CreativeStudioInput = {
    businessContext,
    audience: typeof body.audience === "string" ? body.audience.trim().slice(0, 300) : undefined,
    tone: typeof body.tone === "string" ? body.tone.trim().slice(0, 100) : undefined,
    variantCount: typeof body.variant_count === "number" ? body.variant_count : 3,
  };

  try {
    const variants = await generateCreativeCopy({ apiKey, model }, input);
    return json(req, { ok: true, variants });
  } catch (err) {
    console.error("creative-studio-generate: generation failed", err instanceof Error ? err.message : err);
    const { error: refundError } = await serviceSb.rpc("refund_entitlement", { p_workspace_id: workspaceId, p_key: "creative_generations", p_amount: 1 });
    if (refundError) console.error("creative-studio-generate: refund failed", refundError.message);
    return json(req, { error: "Unable to generate copy right now. Try again shortly. No generation was used." }, 502);
  }
});

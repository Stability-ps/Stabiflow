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
import { bearerToken, createCallerClient, getCallerUserId, hasWorkspacePermission, json } from "../_shared/contentAuth.ts";
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

  const statusGate = await assertWorkspaceActive(callerSb, workspaceId);
  if (!statusGate.allowed) return json(req, workspaceSuspendedBody(statusGate.status), 403);

  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim();
  const model = Deno.env.get("OPENAI_FLOW_AI_MODEL")?.trim();
  if (!apiKey || !model) {
    console.error("creative-studio-generate: OPENAI_API_KEY/OPENAI_FLOW_AI_MODEL not configured");
    return json(req, { error: "Creative Studio is not configured yet. Contact support." }, 503);
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
    return json(req, { error: "Unable to generate copy right now. Try again shortly." }, 502);
  }
});

import { bearerToken, createCallerClient, createServiceClient, getCallerUserId, hasWorkspacePermission, json } from "../_shared/contentAuth.ts";
import { assertWorkspaceActive, workspaceSuspendedBody } from "../_shared/workspaceStatus.ts";

const CONTENT_MEDIA_BUCKET = "content-media";

type CaptionSuggestion = { caption: string; hashtags: string[]; cta: string };

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    cta: { type: "string" },
  },
  required: ["caption", "hashtags", "cta"],
  additionalProperties: false,
};

function extractOutputText(data: any): string {
  if (typeof data?.output_text === "string" && data.output_text) return data.output_text;
  for (const item of data?.output || []) {
    for (const part of item?.content || []) {
      if (part?.type === "output_text" && typeof part.text === "string") return part.text;
    }
  }
  return "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": req.headers.get("origin") || "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json(req, { error: "Forbidden" }, 403);
  const callerSb = createCallerClient(token);
  const actorId = await getCallerUserId(callerSb);
  if (!actorId) return json(req, { error: "Forbidden" }, 403);

  let body: { workspace_id?: unknown; media_asset_id?: unknown; target_platform?: unknown; tone?: unknown };
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON body" }, 400); }

  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  const mediaAssetId = typeof body.media_asset_id === "string" ? body.media_asset_id : "";
  const targetPlatform = body.target_platform === "instagram" ? "instagram" : body.target_platform === "facebook" ? "facebook" : "social media";
  const tone = typeof body.tone === "string" ? body.tone.trim().slice(0, 80) : "professional";
  if (!workspaceId || !mediaAssetId) return json(req, { error: "workspace_id and media_asset_id are required" }, 400);

  if (!(await hasWorkspacePermission(callerSb, workspaceId, "content.create"))) return json(req, { error: "Forbidden" }, 403);
  const statusGate = await assertWorkspaceActive(callerSb, workspaceId);
  if (!statusGate.allowed) return json(req, workspaceSuspendedBody(statusGate.status), 403);

  const { data: asset, error: assetError } = await callerSb.from("content_media_assets")
    .select("id, workspace_id, title, storage_path, mime_type")
    .eq("id", mediaAssetId).eq("workspace_id", workspaceId).maybeSingle();
  if (assetError || !asset) return json(req, { error: "Media asset not found" }, 404);
  if (!String(asset.mime_type || "").startsWith("image/")) return json(req, { error: "AI caption generation currently supports images only." }, 400);

  const serviceSb = createServiceClient();
  const { data: allowed, error: quotaError } = await serviceSb.rpc("consume_entitlement", {
    p_workspace_id: workspaceId, p_key: "ai_credits", p_amount: 1,
  });
  if (quotaError) return json(req, { error: "Unable to verify your AI allowance. Try again shortly." }, 503);
  if (allowed !== true) return json(req, { error: "Your monthly AI allowance has been reached.", code: "USAGE_LIMIT_REACHED" }, 429);

  const [identityRes, offeringsRes, signedRes] = await Promise.all([
    callerSb.from("business_identities").select("trading_name, legal_name, industry, tagline, short_description, long_description").eq("workspace_id", workspaceId).maybeSingle(),
    callerSb.from("business_offerings").select("name, description, kind").eq("workspace_id", workspaceId).limit(12),
    serviceSb.storage.from(CONTENT_MEDIA_BUCKET).createSignedUrl(asset.storage_path, 300),
  ]);
  const identity = identityRes.data || {};
  const offerings = offeringsRes.data || [];
  const signedUrl = signedRes.data?.signedUrl;
  if (!signedUrl) return json(req, { error: "Unable to prepare this image for caption generation." }, 500);

  const businessName = identity.trading_name || identity.legal_name || "the business";
  const context = [
    `Business: ${businessName}`,
    identity.industry ? `Industry: ${identity.industry}` : "",
    identity.tagline ? `Tagline: ${identity.tagline}` : "",
    identity.short_description ? `Business summary: ${identity.short_description}` : "",
    identity.long_description ? `About: ${String(identity.long_description).slice(0, 900)}` : "",
    offerings.length ? `Services/products: ${offerings.map((o: any) => `${o.name}${o.description ? " - " + o.description : ""}`).join("; ").slice(0, 1200)}` : "",
    `Target platform: ${targetPlatform}`,
    `Tone: ${tone}`,
  ].filter(Boolean).join("\n");

  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim();
  const model = Deno.env.get("OPENAI_FLOW_AI_MODEL")?.trim();
  if (!apiKey || !model) return json(req, { error: "AI caption generation is not configured yet." }, 503);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model, store: false,
        instructions: [
          "You create social-media copy for the customer's own business.",
          "Study the supplied image and use the supplied business context.",
          "Write one natural, specific caption that fits what is actually visible and the business.",
          "Never invent prices, discounts, awards, locations, products, services, claims, or events not supported by the image/context.",
          "Do not describe visual details with false certainty; if ambiguous, keep the wording general.",
          "Caption should usually be 1-3 short paragraphs and suitable for Facebook or Instagram.",
          "Return 3-8 concise relevant hashtags without # in the array.",
          "Return a short CTA. If no strong CTA is justified, use a neutral one such as Learn more or Get in touch."
        ].join(" "),
        input: [{ role: "user", content: [
          { type: "input_text", text: context },
          { type: "input_image", image_url: signedUrl, detail: "auto" },
        ] }],
        text: { verbosity: "medium", format: { type: "json_schema", name: "stabiflow_content_caption", strict: true, schema: OUTPUT_SCHEMA } },
      }),
    });
    const raw = await response.text();
    if (!response.ok) {
      console.error("content-ai-caption OpenAI", response.status, raw.slice(0, 400));
      return json(req, { error: "Unable to generate a caption right now. Try again shortly." }, 502);
    }
    const parsed = JSON.parse(raw);
    const output = extractOutputText(parsed);
    if (!output) throw new Error("No output text");
    const suggestion = JSON.parse(output) as CaptionSuggestion;
    suggestion.caption = String(suggestion.caption || "").trim().slice(0, 2200);
    suggestion.cta = String(suggestion.cta || "").trim().slice(0, 120);
    suggestion.hashtags = Array.isArray(suggestion.hashtags) ? suggestion.hashtags.map((h) => String(h).replace(/^#+/, "").trim()).filter(Boolean).slice(0, 8) : [];
    return json(req, { ok: true, suggestion });
  } catch (err) {
    console.error("content-ai-caption failed", err instanceof Error ? err.message : err);
    return json(req, { error: "Unable to generate a caption right now. Try again shortly." }, 502);
  }
});
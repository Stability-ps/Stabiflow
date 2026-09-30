// Business Studio actions (one dispatcher):
//
//  * scan             { workspace_id, url }                      admin
//  * preview          { workspace_id }                           member
//  * improve_wording  { workspace_id, tone? }                    admin
//  * generate_document{ workspace_id, template_key, title? }    admin
//  * extract_text     { workspace_id, text }                     admin
//      ("upload existing profile" - pasted text -> verified proposals)
//
// Authorization: role checked AS THE CALLER (has_workspace_role), then the
// service-role client does the work. Entitlements are enforced HERE,
// server-side, via the canonical evaluator - website_scans / ai_credits are
// consumed atomically before any external call, premium templates and the
// document limit are checked before rendering, and the watermark decision
// (business_profile.pdf_export) is made here, never by the browser.
import {
  bearerToken, createCallerClient, createServiceClient, getCallerUserId, hasWorkspaceRole, json, optionalEnvVar,
  type AnySupabaseClient,
} from "../_shared/contentAuth.ts";
import { normalizeWebsiteInput, UnsafeUrlError } from "../_shared/businessStudio/safeFetch.ts";
import { runScan, runTextExtraction } from "../_shared/businessStudio/scanRunner.ts";
import { improveWording, WORDING_FIELDS, type AiCredential, type WordingField } from "../_shared/businessStudio/ai.ts";
import { loadLogo, loadProfileContent } from "../_shared/businessStudio/documentData.ts";
import { renderProfilePdf, type TemplateLayout } from "../_shared/businessStudio/profilePdf.ts";

const DOCUMENTS_BUCKET = "business-documents";
const TONES = new Set(["professional", "friendly", "confident", "formal"]);

type Ent = { entitlement_key: string; enabled: boolean; limit_value: number | null; unlimited: boolean };

async function entitlements(sb: AnySupabaseClient, workspaceId: string): Promise<Record<string, Ent>> {
  const { data, error } = await sb.rpc("get_workspace_entitlements", { p_workspace_id: workspaceId });
  if (error) throw new Error(`entitlements: ${error.message}`);
  return Object.fromEntries(((data ?? []) as Ent[]).map((e) => [e.entitlement_key, e]));
}

async function consume(sb: AnySupabaseClient, workspaceId: string, key: string): Promise<boolean> {
  const { data, error } = await sb.rpc("consume_entitlement", { p_workspace_id: workspaceId, p_key: key, p_amount: 1 });
  if (error) throw new Error(`consume ${key}: ${error.message}`);
  return data === true;
}

function aiCredential(): AiCredential | null {
  const apiKey = optionalEnvVar("OPENAI_API_KEY");
  if (!apiKey) return null;
  return { apiKey, model: optionalEnvVar("OPENAI_FLOW_AI_MODEL") ?? "gpt-4o-mini" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json(req, {}, 200);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = bearerToken(req);
  if (!token) return json(req, { error: "Unauthorized" }, 401);
  const callerSb = createCallerClient(token);
  const userId = await getCallerUserId(callerSb);
  if (!userId) return json(req, { error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, 400);
  }
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  if (!workspaceId) return json(req, { error: "workspace_id is required" }, 400);
  const action = body.action;

  const { data: isMember } = await callerSb.rpc("is_workspace_member", { p_workspace_id: workspaceId });
  if (isMember !== true) return json(req, { error: "Forbidden" }, 403);
  const isAdmin = await hasWorkspaceRole(callerSb, workspaceId, "admin");
  const sb = createServiceClient();

  try {
    // -- Preview (read-only) -------------------------------------------------------
    if (action === "preview") {
      const [{ content }, ents, templates] = await Promise.all([
        loadProfileContent(sb, workspaceId),
        entitlements(sb, workspaceId),
        sb.from("profile_templates").select("key, name, description, is_premium, config, sort_order").eq("is_active", true).order("sort_order"),
      ]);
      return json(req, {
        ok: true,
        content,
        templates: templates.data ?? [],
        canExportPdf: !!ents["business_profile.pdf_export"]?.enabled,
        canUsePremium: !!ents["business_profile.premium_designs"]?.enabled,
      });
    }

    if (!isAdmin) return json(req, { error: "Only workspace owners and admins can do this" }, 403);

    // -- Scan -------------------------------------------------------------------------
    if (action === "scan") {
      let url: URL;
      try {
        url = normalizeWebsiteInput(typeof body.url === "string" ? body.url : "");
      } catch (e) {
        return json(req, { error: e instanceof UnsafeUrlError ? e.message : "Invalid website address" }, 400);
      }
      const ents = await entitlements(sb, workspaceId);
      if (!ents["business_studio.access"]?.enabled) return json(req, { error: "Business Studio is not available on your plan" }, 403);
      if (!(await consume(sb, workspaceId, "website_scans"))) {
        return json(req, { error: "You've used all your website scans for this month. Upgrade your plan for more.", code: "limit_reached" }, 402);
      }
      const outcome = await runScan(sb, { workspaceId, url, purpose: "onboarding", userId, ai: aiCredential() });
      if (outcome.status !== "completed") return json(req, { ok: false, error: outcome.error, scan_id: outcome.scanId }, 422);
      return json(req, { ok: true, ...outcome });
    }

    // -- Existing profile text (AI, credit-metered) ------------------------------------
    if (action === "extract_text") {
      const cred = aiCredential();
      if (!cred) return json(req, { error: "Reading an existing profile is not available right now" }, 503);
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (text.length < 80) return json(req, { error: "Paste at least a few sentences from your existing profile" }, 400);
      if (text.length > 20_000) return json(req, { error: "That text is too long - paste up to 20 000 characters" }, 400);
      if (!(await consume(sb, workspaceId, "ai_credits"))) {
        return json(req, { error: "You've used all your AI credits for this month.", code: "limit_reached" }, 402);
      }
      const outcome = await runTextExtraction(sb, { workspaceId, text, userId, ai: cred });
      return json(req, { ok: true, ...outcome });
    }

    // -- Improve wording (AI, credit-metered) ----------------------------------------
    if (action === "improve_wording") {
      const cred = aiCredential();
      if (!cred) return json(req, { error: "AI writing is not available right now" }, 503);
      const tone = typeof body.tone === "string" && TONES.has(body.tone) ? body.tone : "professional";
      const { data: identity } = await sb.from("business_identities").select("*").eq("workspace_id", workspaceId).single();
      const fields: Partial<Record<WordingField, string>> = {};
      for (const f of WORDING_FIELDS) if (typeof identity?.[f] === "string" && identity[f].trim()) fields[f] = identity[f];
      if (Object.keys(fields).length === 0) return json(req, { error: "Add a description, tagline, mission or vision first - AI only improves text you've written" }, 400);
      if (!(await consume(sb, workspaceId, "ai_credits"))) {
        return json(req, { error: "You've used all your AI credits for this month.", code: "limit_reached" }, 402);
      }
      const started = Date.now();
      let result;
      try {
        result = await improveWording(cred, fields, tone);
      } catch (e) {
        await sb.from("ai_usage_events").insert({ workspace_id: workspaceId, user_id: userId, feature: "business_studio_wording", provider: "openai", model: cred.model, status: "error" });
        console.error("improve_wording failed", e instanceof Error ? e.message : e);
        return json(req, { error: "AI writing failed. Please try again." }, 502);
      }
      await sb.from("ai_usage_events").insert({
        workspace_id: workspaceId, user_id: userId, feature: "business_studio_wording", provider: "openai", model: cred.model,
        input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens, latency_ms: Date.now() - started, status: "success",
      });
      const entries = Object.entries(result.suggestions) as [WordingField, string][];
      if (entries.length) {
        await sb.from("business_fact_proposals").update({ status: "superseded", reviewed_at: new Date().toISOString() })
          .eq("workspace_id", workspaceId).eq("origin", "ai_wording").eq("status", "pending");
        await sb.from("business_fact_proposals").insert(entries.map(([field, value]) => ({
          workspace_id: workspaceId, origin: "ai_wording", target: "identity_field", field, proposed: { value }, current_value: { value: fields[field] },
          evidence: "AI rewording of your own text - no new facts added", extraction_method: "ai_wording",
        })));
      }
      return json(req, { ok: true, suggestions: entries.length, rejected: result.rejected });
    }

    // -- Generate PDF document --------------------------------------------------------
    if (action === "generate_document") {
      const templateKey = typeof body.template_key === "string" ? body.template_key : "classic";
      const { data: template } = await sb.from("profile_templates").select("*").eq("key", templateKey).eq("is_active", true).maybeSingle();
      if (!template) return json(req, { error: "That design is not available" }, 400);
      const ents = await entitlements(sb, workspaceId);
      if (template.is_premium && !ents["business_profile.premium_designs"]?.enabled) {
        return json(req, { error: "This design is included with a paid plan", code: "upgrade_required" }, 402);
      }
      const docEnt = ents["business_profile.documents"];
      const { count } = await sb.from("business_documents").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "generated");
      if (!docEnt?.enabled || (!docEnt.unlimited && (count ?? 0) >= Number(docEnt.limit_value ?? 0))) {
        return json(req, { error: "You've reached the number of saved documents on your plan. Delete one or upgrade.", code: "limit_reached" }, 402);
      }
      const watermark = !ents["business_profile.pdf_export"]?.enabled;

      const { content, logoPath } = await loadProfileContent(sb, workspaceId);
      const logo = await loadLogo(sb, logoPath);
      const config = (template.config ?? {}) as { layout?: TemplateLayout; headingFont?: "serif" | "sans" };
      const { bytes, pageCount } = await renderProfilePdf(content, {
        layout: config.layout ?? "band", headingFont: config.headingFont ?? "sans", watermark, logo,
      });

      const docId = crypto.randomUUID();
      const path = `${workspaceId}/${docId}.pdf`;
      const { error: upErr } = await sb.storage.from(DOCUMENTS_BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: false });
      if (upErr) throw new Error(`upload: ${upErr.message}`);
      const title = (typeof body.title === "string" && body.title.trim() ? body.title.trim() : `${content.name} - Company Profile`).slice(0, 200);
      const { data: doc, error: docErr } = await sb
        .from("business_documents")
        .insert({ id: docId, workspace_id: workspaceId, title, template_key: template.key, content, storage_path: path, watermarked: watermark, page_count: pageCount, created_by: userId })
        .select("id, title, template_key, watermarked, page_count, created_at")
        .single();
      if (docErr) {
        await sb.storage.from(DOCUMENTS_BUCKET).remove([path]);
        throw new Error(`document insert: ${docErr.message}`);
      }
      const { data: signed } = await sb.storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, 300);
      return json(req, { ok: true, document: doc, url: signed?.signedUrl ?? null });
    }

    return json(req, { error: "Unknown action" }, 400);
  } catch (e) {
    console.error("business-studio failed", action, e instanceof Error ? e.message : e);
    return json(req, { error: "Something went wrong. Please try again." }, 500);
  }
});

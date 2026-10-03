// Phase 9 - WhatsApp outbound retry worker. Cron-triggered (pg_cron ->
// pg_net, see 20260927060000), authorised by a shared secret header only.
//
// One bounded pass:
//   1. claim_whatsapp_retry_batch() - atomic FOR UPDATE SKIP LOCKED claim
//      of due, failed, not-dead-lettered, not-accepted outbound rows
//      (<=5 per workspace per tick, global cap 20).
//   2. for each: reload the conversation, re-run EVERY outbound safety
//      gate against CURRENT state (workspace active, credential, template
//      still APPROVED, 24h window if free-form). A gate that now fails ->
//      apply_whatsapp_retry_outcome(policy_blocked) -> dead-letter.
//   3. otherwise send ONCE through the real provider, then
//      apply_whatsapp_retry_outcome(success|retryable|permanent).
//
// The provider send is REAL (a cron POST is not a test-harness request):
// the delivery state machine + claim logic in SQL is what the integration
// tests exercise directly; this glue is smoke-tested on the schedule.
import { createServiceClient, envVar } from "../_shared/contentAuth.ts";
import { assertWorkspaceActive } from "../_shared/workspaceStatus.ts";
import { resolveMessagingWindow } from "../_shared/inbox/messagingWindow.ts";
import { validateTemplateEligibility } from "../_shared/inbox/templateValidation.ts";
import { REAL_WHATSAPP_PROVIDER } from "../_shared/inbox/whatsappSendProvider.ts";
import { classifyOutboundFailure } from "../_shared/inbox/outboundRetry.ts";
import { evaluateRetryGates } from "../_shared/inbox/outboundRetryWorker.ts";
import { cleanReply } from "../_shared/inbox/replyGuardrails.ts";

// deno-lint-ignore no-explicit-any
type AnySb = any;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

type ClaimedRow = {
  id: string; workspace_id: string; conversation_id: string; retry_count: number;
  message_type: string; content: string | null; sender_type: string;
  template_id: string | null; template_parameters: string[] | null;
};

async function resolveCredential(sb: AnySb, whatsappNumberId: string) {
  const { data: numberRow } = await sb.from("workspace_whatsapp_numbers").select("id,phone_number_id,integration_id,is_active").eq("id", whatsappNumberId).maybeSingle();
  if (!numberRow || numberRow.is_active === false) return null;
  const { data: integration } = await sb.from("workspace_integrations").select("id,status").eq("id", numberRow.integration_id).maybeSingle();
  if (!integration || integration.status !== "connected") return null;
  const { data: token, error } = await sb.rpc("get_workspace_integration_secret", { p_integration_id: integration.id });
  if (error || !token) return null;
  return { token, phoneNumberId: numberRow.phone_number_id, apiVersion: Deno.env.get("INTEGRATIONS_META_GRAPH_API_VERSION")?.trim() || "" };
}

async function processRow(sb: AnySb, row: ClaimedRow) {
  const { data: conv } = await sb.from("inbox_conversations").select("id,wa_id,whatsapp_number_id").eq("id", row.conversation_id).maybeSingle();
  if (!conv) {
    await sb.rpc("apply_whatsapp_retry_outcome", { p_message_id: row.id, p_outcome: "permanent", p_failure_code: "conversation_missing", p_failure_category: "invalid_resource", p_source: "retry_worker" });
    return "dead_lettered";
  }

  const isTemplate = row.message_type === "template";
  const gate = await assertWorkspaceActive(sb, row.workspace_id);
  const cred = await resolveCredential(sb, conv.whatsapp_number_id);

  let templateEligible: boolean | null = null;
  let templateErrorCode: string | null = null;
  let tplName: string | null = null;
  let tplLang: string | null = null;
  if (isTemplate) {
    const { data: tpl } = await sb.from("whatsapp_message_templates").select("name,language,provider_status,components").eq("id", row.template_id).eq("workspace_id", row.workspace_id).maybeSingle();
    const elig = validateTemplateEligibility(tpl ? { provider_status: tpl.provider_status, language: tpl.language, components: tpl.components } : null, (row.template_parameters ?? []).length);
    templateEligible = elig.ok;
    if (!elig.ok) templateErrorCode = `template_${elig.error.code}`;
    else { tplName = tpl!.name; tplLang = tpl!.language; }
  }

  let windowOpen = true;
  if (!isTemplate) windowOpen = (await resolveMessagingWindow(sb, row.conversation_id)).state === "open";

  const decision = evaluateRetryGates({
    messageType: row.message_type,
    workspaceActive: gate.allowed,
    hasCredential: !!cred,
    windowOpen,
    templateEligible,
    templateErrorCode,
  });
  if (!decision.proceed) {
    await sb.rpc("apply_whatsapp_retry_outcome", { p_message_id: row.id, p_outcome: "policy_blocked", p_failure_code: decision.code, p_failure_category: "policy_blocked", p_source: "retry_worker" });
    return "dead_lettered";
  }

  let wamid: string | null = null;
  let outcome: "success" | "retryable" | "permanent" | "policy_blocked" = "success";
  let code: string | null = null;
  let cat: string | null = null;
  try {
    wamid = isTemplate
      ? await REAL_WHATSAPP_PROVIDER.sendTemplate(cred!, conv.wa_id, { name: tplName!, language: tplLang!, bodyParameters: (row.template_parameters ?? []).map((t) => ({ type: "text" as const, text: t })) })
      : await REAL_WHATSAPP_PROVIDER.sendText(cred!, conv.wa_id, cleanReply(row.content ?? ""));
  } catch (err) {
    const c = classifyOutboundFailure(err);
    outcome = c.failureClass; code = c.code; cat = c.category;
  }
  const { data } = await sb.rpc("apply_whatsapp_retry_outcome", {
    p_message_id: row.id, p_outcome: outcome, p_failure_code: code, p_failure_category: cat,
    p_provider_message_id: wamid, p_source: "retry_worker",
  });
  return (data as { result?: string } | null)?.result ?? "unknown";
}

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret") || "";
  const expected = envVar("WHATSAPP_RETRY_CRON_SECRET");
  if (!expected || !timingSafeEqual(provided, expected)) return json({ error: "Forbidden" }, 403);

  const sb = createServiceClient();
  const { data: claimed, error } = await sb.rpc("claim_whatsapp_retry_batch", { p_limit: 20 });
  if (error) {
    console.error("whatsapp-outbound-retry-tick: claim failed", error.message);
    return json({ ok: false, error: error.message }, 500);
  }
  const rows = (claimed ?? []) as ClaimedRow[];
  const results: Record<string, number> = {};
  for (const row of rows) {
    try {
      const r = await processRow(sb, row);
      results[r] = (results[r] ?? 0) + 1;
    } catch (err) {
      console.error("whatsapp-outbound-retry-tick: row failed", err instanceof Error ? err.message : err);
      results.error = (results.error ?? 0) + 1;
    }
  }
  return json({ ok: true, claimed: rows.length, ...results });
});

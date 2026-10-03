// Paystack webhook receiver.
//
// No Supabase JWT (verify_jwt = false in config.toml): authenticity is the
// x-paystack-signature HMAC-SHA512 of the RAW body, verified BEFORE the
// body is parsed or acted on. Every delivery - valid or not - is logged to
// billing_webhook_events with a sha256 dedupe key, so a redelivery of the
// same event is recognised and never processed twice (the billing SQL
// functions are independently idempotent by reference as a second line of
// defence).
//
// Always answers 200 for a correctly-signed event once it is recorded, even
// if processing failed: Paystack retries non-2xx responses, and a failed
// event is visible in Admin (processing_status = 'failed') and picked up by
// the reconcile tick's verify path instead.
import { createServiceClient } from "../_shared/contentAuth.ts";
import { paystackConfigFromEnv, sha256Hex, verifyPaystackSignature } from "../_shared/billing/paystack.ts";
import { processPaystackEvent, type PaystackEvent } from "../_shared/billing/processPaystackEvent.ts";
import { sendBillingEmailForEvent } from "../_shared/billing/billingEmail.ts";

const MAX_BODY_BYTES = 256 * 1024;

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  const cfg = paystackConfigFromEnv();
  if (!cfg.secretKey) return reply({ error: "Not configured" }, 503);

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return reply({ error: "Payload too large" }, 413);
  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) return reply({ error: "Payload too large" }, 413);

  const signatureValid = await verifyPaystackSignature(cfg.secretKey, rawBody, req.headers.get("x-paystack-signature"));

  let event: PaystackEvent = {};
  try {
    event = JSON.parse(rawBody) as PaystackEvent;
  } catch {
    event = {};
  }

  const sb = createServiceClient();
  const dedupeKey = await sha256Hex(rawBody);
  const { data: inserted, error: insertError } = await sb
    .from("billing_webhook_events")
    .insert({
      provider: "paystack",
      dedupe_key: signatureValid ? dedupeKey : `invalid:${dedupeKey}:${crypto.randomUUID()}`,
      event_type: typeof event.event === "string" ? event.event.slice(0, 100) : "(unparseable)",
      signature_valid: signatureValid,
      // Never store an unverified body: it is attacker-controlled input.
      payload: signatureValid ? event : {},
      processing_status: signatureValid ? "received" : "ignored",
      processing_result: signatureValid ? null : "invalid signature",
    })
    .select("id")
    .maybeSingle();

  if (!signatureValid) return reply({ error: "Invalid signature" }, 401);

  if (insertError) {
    // 23505 = unique violation on dedupe_key: we have seen this exact event.
    if ((insertError as { code?: string }).code === "23505") return reply({ ok: true, duplicate: true });
    return reply({ error: "Could not record event" }, 500);
  }

  let outcome;
  try {
    outcome = await processPaystackEvent(sb, cfg, event, "webhook");
  } catch (e) {
    outcome = { status: "failed" as const, result: e instanceof Error ? e.message.slice(0, 900) : "processing error", workspaceId: null };
  }

  if (outcome.status === "processed" && outcome.workspaceId) {
    await sendBillingEmailForEvent(sb, event, outcome).catch((e) =>
      console.error("billing email hook failed", e instanceof Error ? e.message : "error")
    );
  }

  await sb
    .from("billing_webhook_events")
    .update({
      processing_status: outcome.status,
      processing_result: outcome.result.slice(0, 1000),
      workspace_id: outcome.workspaceId ?? null,
      processed_at: new Date().toISOString(),
    })
    .eq("id", inserted!.id);

  return reply({ ok: true });
});

// WhatsApp webhook receiver - ROUTING FOUNDATION ONLY (Phase C instruction
// #13/#14/#15/#41). This function proves and exercises the routing path
// phone_number_id -> workspace_whatsapp_numbers -> integration -> workspace
// that the future Inbox phase depends on. It deliberately does NOT parse
// message content, create conversations, or reply to anything - see
// instruction #43 ("do not migrate WhatsApp Inbox / do not send WhatsApp
// replies").
//
// Hit directly by Meta's webhook infrastructure, not by StabiFlow's
// frontend - deployed with verify_jwt=false (see supabase/config.toml).
// Every inbound POST is signature-verified (X-Hub-Signature-256, HMAC-SHA256
// over the RAW body) before its JSON is even parsed - this is the entire
// authentication boundary for this endpoint, replacing what a JWT would
// normally provide. Routing NEVER trusts a caller-supplied workspace id
// (there isn't one in a webhook payload to begin with) - only the
// signature-verified phone_number_id, looked up against StabiFlow's own
// workspace_whatsapp_numbers table.
import { verifyMetaWebhookSignature, verifyWebhookChallenge } from "../_shared/integration-providers/webhookSignature.ts";
import { parseWhatsAppWebhookEvents } from "../_shared/integration-providers/whatsappWebhookPayload.ts";
import { createServiceClient, envVar } from "../_shared/contentAuth.ts";

function text(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

Deno.serve(async (req: Request) => {
  const reqUrl = new URL(req.url);

  if (req.method === "GET") {
    // Meta's one-time verification handshake when the webhook URL is
    // configured in the App dashboard.
    const challenge = verifyWebhookChallenge({
      mode: reqUrl.searchParams.get("hub.mode"),
      verifyToken: reqUrl.searchParams.get("hub.verify_token"),
      expectedVerifyToken: envVar("WHATSAPP_WEBHOOK_VERIFY_TOKEN"),
      challenge: reqUrl.searchParams.get("hub.challenge"),
    });
    if (challenge === null) return text("Forbidden", 403);
    return text(challenge, 200);
  }

  if (req.method !== "POST") return text("Method not allowed", 405);

  const rawBody = await req.text();
  const signatureHeader = req.headers.get("x-hub-signature-256");
  const appSecret = envVar("INTEGRATIONS_META_APP_SECRET");
  const verified = await verifyMetaWebhookSignature(appSecret, rawBody, signatureHeader);
  if (!verified) return text("Forbidden", 403);

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Signature was valid but the body isn't JSON - ack anyway so Meta
    // doesn't retry-storm a malformed delivery it will never fix.
    return text("OK", 200);
  }

  const events = parseWhatsAppWebhookEvents(payload);
  const serviceSb = createServiceClient();

  for (const event of events) {
    // Resolve phone_number_id -> workspace, purely from StabiFlow's own
    // table - the webhook payload is never trusted to say WHICH workspace
    // this is for (instruction #14: "do not route inbound webhook events
    // solely based on a caller-provided workspace ID").
    const { data: numberRow } = await serviceSb
      .from("workspace_whatsapp_numbers")
      .select("workspace_id")
      .eq("phone_number_id", event.phoneNumberId)
      .eq("is_active", true)
      .maybeSingle();

    // Idempotent insert: the unique index on (phone_number_id,
    // provider_event_id) makes a retried delivery a safe no-op rather than
    // double-processing (instruction #15/#41). An unresolved number is
    // still recorded (workspace_id null) instead of silently dropped, so
    // "we got an event for a number we don't recognise" stays visible.
    const { error: insertError } = await serviceSb.from("workspace_whatsapp_webhook_events").insert({
      workspace_id: numberRow?.workspace_id ?? null,
      phone_number_id: event.phoneNumberId,
      provider_event_id: event.eventId,
      event_type: event.eventType,
      payload_summary: { resolved: !!numberRow },
    });
    // A 23505 unique-violation here IS the idempotency guarantee working -
    // this exact (phone_number_id, provider_event_id) was already
    // recorded, so this is a safe no-op, not an error to surface.
    if (insertError && insertError.code !== "23505") {
      console.error("whatsapp-webhook: failed to record event", insertError.message);
    }
  }

  // Meta expects a fast 200 ack regardless of what routing found - a slow
  // or non-200 response causes Meta to retry (and eventually disable) the
  // subscription.
  return text("OK", 200);
});

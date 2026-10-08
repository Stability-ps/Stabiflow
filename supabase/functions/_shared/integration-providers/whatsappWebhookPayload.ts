// Pure parser for WhatsApp webhook payloads (Phase C instruction #13/#15).
// Extracts exactly what routing/idempotency needs - phone_number_id and a
// per-event provider id - and nothing else. This phase does NOT parse
// message content/type for processing (that's the Inbox phase); only the
// identifiers needed to prove the routing path and dedupe delivery.

export type WebhookRoutableEvent = {
  phoneNumberId: string;
  eventId: string;
  eventType: "message" | "status";
};

type WhatsAppWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        messages?: Array<{ id?: string }>;
        statuses?: Array<{ id?: string }>;
      };
    }>;
  }>;
};

export function parseWhatsAppWebhookEvents(payload: unknown): WebhookRoutableEvent[] {
  const body = payload as WhatsAppWebhookPayload;
  const events: WebhookRoutableEvent[] = [];
  for (const entry of body?.entry || []) {
    for (const change of entry?.changes || []) {
      const phoneNumberId = change?.value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      for (const message of change?.value?.messages || []) {
        if (message?.id) events.push({ phoneNumberId, eventId: message.id, eventType: "message" });
      }
      for (const status of change?.value?.statuses || []) {
        if (status?.id) events.push({ phoneNumberId, eventId: status.id, eventType: "status" });
      }
    }
  }
  return events;
}

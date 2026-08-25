import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseWhatsAppWebhookEvents } from "./whatsappWebhookPayload.ts";

const SAMPLE_MESSAGE_PAYLOAD = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "waba-1",
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: "phone-123", display_phone_number: "+27820000001" },
            messages: [{ id: "wamid.MESSAGE_1", from: "27820000002", type: "text" }],
          },
        },
      ],
    },
  ],
};

const SAMPLE_STATUS_PAYLOAD = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "waba-1",
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: "phone-123" },
            statuses: [{ id: "wamid.MESSAGE_1", status: "delivered" }],
          },
        },
      ],
    },
  ],
};

Deno.test("extracts a routable event for an inbound message with the correct phone_number_id", () => {
  assertEquals(parseWhatsAppWebhookEvents(SAMPLE_MESSAGE_PAYLOAD), [{ phoneNumberId: "phone-123", eventId: "wamid.MESSAGE_1", eventType: "message" }]);
});

Deno.test("extracts a routable event for a status callback (delivered/read/failed)", () => {
  assertEquals(parseWhatsAppWebhookEvents(SAMPLE_STATUS_PAYLOAD), [{ phoneNumberId: "phone-123", eventId: "wamid.MESSAGE_1", eventType: "status" }]);
});

Deno.test("REGRESSION: a change with no phone_number_id in metadata contributes zero events - never routed by guesswork", () => {
  const payload = { entry: [{ changes: [{ value: { messages: [{ id: "wamid.X" }] } }] }] };
  assertEquals(parseWhatsAppWebhookEvents(payload), []);
});

Deno.test("a message/status entry missing its own id is skipped, not crashed on", () => {
  const payload = { entry: [{ changes: [{ value: { metadata: { phone_number_id: "phone-123" }, messages: [{}] } }] }] };
  assertEquals(parseWhatsAppWebhookEvents(payload), []);
});

Deno.test("multiple entries/changes/messages in one delivery all get extracted, each tagged with its own phone_number_id", () => {
  const payload = {
    entry: [
      { changes: [{ value: { metadata: { phone_number_id: "phone-A" }, messages: [{ id: "m1" }, { id: "m2" }] } }] },
      { changes: [{ value: { metadata: { phone_number_id: "phone-B" }, messages: [{ id: "m3" }] } }] },
    ],
  };
  assertEquals(parseWhatsAppWebhookEvents(payload), [
    { phoneNumberId: "phone-A", eventId: "m1", eventType: "message" },
    { phoneNumberId: "phone-A", eventId: "m2", eventType: "message" },
    { phoneNumberId: "phone-B", eventId: "m3", eventType: "message" },
  ]);
});

Deno.test("malformed/empty payload never throws - returns an empty routing list", () => {
  assertEquals(parseWhatsAppWebhookEvents({}), []);
  assertEquals(parseWhatsAppWebhookEvents(null), []);
  assertEquals(parseWhatsAppWebhookEvents(undefined), []);
});

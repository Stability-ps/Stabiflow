import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizePhone, parseInboundMessageEvents } from "./webhookMessageParser.ts";

function payload(value: Record<string, unknown>) {
  return { entry: [{ changes: [{ value }] }] };
}

Deno.test("parses a plain text message with the sender's display name", () => {
  const events = parseInboundMessageEvents(payload({
    metadata: { phone_number_id: "phone-1" },
    contacts: [{ wa_id: "27820000001", profile: { name: "Jane Customer" } }],
    messages: [{ from: "27820000001", id: "wamid.1", type: "text", text: { body: "Hi there" } }],
  }));

  assertEquals(events.length, 1);
  assertEquals(events[0], {
    phoneNumberId: "phone-1",
    waId: "27820000001",
    messageId: "wamid.1",
    kind: "text",
    text: "Hi there",
    displayName: "Jane Customer",
    referral: null,
    mediaId: null,
    mime: null,
    filename: null,
    sha256: null,
  });
});

Deno.test("parses an image message with caption and media metadata", () => {
  const events = parseInboundMessageEvents(payload({
    metadata: { phone_number_id: "phone-1" },
    messages: [{ from: "27820000001", id: "wamid.2", type: "image", image: { id: "media-1", mime_type: "image/jpeg", caption: "See attached", sha256: "abc" } }],
  }));

  assertEquals(events[0].kind, "image");
  assertEquals(events[0].text, "See attached");
  assertEquals(events[0].mediaId, "media-1");
  assertEquals(events[0].mime, "image/jpeg");
  assertEquals(events[0].sha256, "abc");
});

Deno.test("parses a document message with its filename", () => {
  const events = parseInboundMessageEvents(payload({
    metadata: { phone_number_id: "phone-1" },
    messages: [{ from: "27820000001", id: "wamid.3", type: "document", document: { id: "media-2", mime_type: "application/pdf", filename: "invoice.pdf" } }],
  }));

  assertEquals(events[0].kind, "document");
  assertEquals(events[0].filename, "invoice.pdf");
});

Deno.test("an unrecognised message type is classified unsupported, not dropped", () => {
  const events = parseInboundMessageEvents(payload({
    metadata: { phone_number_id: "phone-1" },
    messages: [{ from: "27820000001", id: "wamid.4", type: "sticker" }],
  }));

  assertEquals(events[0].kind, "unsupported");
});

Deno.test("extracts click-to-WhatsApp ad referral metadata when Meta supplies it - the future Campaign attribution hook", () => {
  const events = parseInboundMessageEvents(payload({
    metadata: { phone_number_id: "phone-1" },
    messages: [{
      from: "27820000001", id: "wamid.5", type: "text", text: { body: "Interested in your ad" },
      referral: { source_type: "ad", source_id: "1234567890", headline: "Spring sale", ctwa_clid: "clid-abc" },
    }],
  }));

  assertEquals(events[0].referral, { sourceType: "ad", sourceId: "1234567890", headline: "Spring sale", ctwaClid: "clid-abc" });
});

Deno.test("Phase 10: a WhatsApp push-to-talk voice note parses as kind 'voice' with its audio metadata", () => {
  const events = parseInboundMessageEvents(payload({
    metadata: { phone_number_id: "phone-1" },
    messages: [{ from: "27820000001", id: "wamid.v1", type: "audio", audio: { id: "media-v1", mime_type: "audio/ogg; codecs=opus", sha256: "vv", voice: true } }],
  }));
  assertEquals(events[0].kind, "voice");
  assertEquals(events[0].mediaId, "media-v1");
  assertEquals(events[0].mime, "audio/ogg; codecs=opus");
  assertEquals(events[0].sha256, "vv");
  assertEquals(events[0].text, "");
  assertEquals(events[0].filename, null);
});

Deno.test("Phase 10: a regular inbound audio file (voice flag absent/false) parses as kind 'audio', not 'voice'", () => {
  const off = parseInboundMessageEvents(payload({
    metadata: { phone_number_id: "phone-1" },
    messages: [{ from: "27820000001", id: "wamid.a1", type: "audio", audio: { id: "media-a1", mime_type: "audio/mpeg", voice: false } }],
  }));
  assertEquals(off[0].kind, "audio");
  const absent = parseInboundMessageEvents(payload({
    metadata: { phone_number_id: "phone-1" },
    messages: [{ from: "27820000001", id: "wamid.a2", type: "audio", audio: { id: "media-a2", mime_type: "audio/mp4" } }],
  }));
  assertEquals(absent[0].kind, "audio");
});

Deno.test("REGRESSION: a change with no phone_number_id in metadata contributes zero events - never routed by guesswork", () => {
  const events = parseInboundMessageEvents({
    entry: [{ changes: [{ value: { messages: [{ from: "1", id: "wamid.6", type: "text", text: { body: "hi" } }] } }] }],
  });
  assertEquals(events, []);
});

Deno.test("a message missing from/id is skipped, not crashed on", () => {
  const events = parseInboundMessageEvents(payload({ metadata: { phone_number_id: "phone-1" }, messages: [{ type: "text", text: { body: "hi" } }] }));
  assertEquals(events, []);
});

Deno.test("malformed/empty payload never throws", () => {
  assertEquals(parseInboundMessageEvents({}), []);
  assertEquals(parseInboundMessageEvents(null), []);
  assertEquals(parseInboundMessageEvents(undefined), []);
});

Deno.test("normalizePhone formats a WhatsApp id as a leading-plus E.164-ish string", () => {
  assertEquals(normalizePhone("27820000001"), "+27820000001");
  assertEquals(normalizePhone("+27 82 000 0001"), "+27820000001");
});

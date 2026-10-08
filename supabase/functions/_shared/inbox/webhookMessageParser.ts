// Parses inbound WhatsApp message events out of a webhook payload (Phase D).
// Adapted from Acapolite's whatsapp-agent/index.ts incomingEvents() - the
// parsing logic itself has no business-domain coupling, so this is a
// near-direct port; only the referral field names are kept generic (they
// were already generic in the source - Meta's own click-to-WhatsApp ad
// referral shape, not anything Acapolite-specific).
export type InboundReferral = {
  sourceType: string | null;
  sourceId: string | null;
  headline: string | null;
  ctwaClid: string | null;
};

export type InboundMessageEvent = {
  phoneNumberId: string;
  waId: string;
  messageId: string;
  // Phase 10: `voice` = a WhatsApp push-to-talk voice note (Meta sets
  // audio.voice = true); `audio` = any other inbound audio file. Both are
  // stored + playable; only these two ever get transcribed.
  kind: "text" | "image" | "document" | "voice" | "audio" | "unsupported";
  text: string;
  displayName: string | null;
  referral: InboundReferral | null;
  mediaId: string | null;
  mime: string | null;
  filename: string | null;
  sha256: string | null;
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseReferral(value: unknown): InboundReferral | null {
  if (!value || typeof value !== "object") return null;
  const r = asRecord(value);
  return {
    sourceType: r.source_type ? String(r.source_type) : null,
    sourceId: r.source_id ? String(r.source_id) : null,
    headline: r.headline ? String(r.headline) : null,
    ctwaClid: r.ctwa_clid ? String(r.ctwa_clid) : null,
  };
}

export function parseInboundMessageEvents(payload: unknown): InboundMessageEvent[] {
  const out: InboundMessageEvent[] = [];
  for (const entryValue of asArray(asRecord(payload).entry)) {
    const entry = asRecord(entryValue);
    for (const changeValue of asArray(entry.changes)) {
      const change = asRecord(changeValue);
      const value = asRecord(change.value);
      const phoneNumberId = value.metadata ? String(asRecord(value.metadata).phone_number_id || "") : "";
      if (!phoneNumberId) continue;

      const names = new Map<string, string>();
      for (const contactValue of asArray(value.contacts)) {
        const contact = asRecord(contactValue);
        const profile = asRecord(contact.profile);
        if (contact.wa_id && profile.name) names.set(String(contact.wa_id), String(profile.name));
      }

      for (const messageValue of asArray(value.messages)) {
        const m = asRecord(messageValue);
        const text = asRecord(m.text);
        const image = asRecord(m.image);
        const document = asRecord(m.document);
        const audio = asRecord(m.audio);
        const waId = String(m.from || "").trim();
        const messageId = String(m.id || "").trim();
        if (!waId || !messageId) continue;

        const referral = parseReferral(m.referral);
        const base = { phoneNumberId, waId, messageId, displayName: names.get(waId) || null, referral };

        if (m.type === "text" && text.body) {
          out.push({ ...base, kind: "text", text: String(text.body).trim(), mediaId: null, mime: null, filename: null, sha256: null });
        } else if (m.type === "image") {
          out.push({ ...base, kind: "image", text: String(image.caption || "").trim(), mediaId: image.id ? String(image.id) : null, mime: image.mime_type ? String(image.mime_type) : null, filename: null, sha256: image.sha256 ? String(image.sha256) : null });
        } else if (m.type === "document") {
          out.push({ ...base, kind: "document", text: String(document.caption || "").trim(), mediaId: document.id ? String(document.id) : null, mime: document.mime_type ? String(document.mime_type) : null, filename: document.filename ? String(document.filename) : null, sha256: document.sha256 ? String(document.sha256) : null });
        } else if (m.type === "audio") {
          // Meta's audio object carries `voice: true` for a push-to-talk
          // voice note; a plain audio file has it false/absent. The
          // repository contract - not an assumption - drives the split.
          out.push({
            ...base,
            kind: audio.voice === true ? "voice" : "audio",
            text: "",
            mediaId: audio.id ? String(audio.id) : null,
            mime: audio.mime_type ? String(audio.mime_type) : null,
            filename: null,
            sha256: audio.sha256 ? String(audio.sha256) : null,
          });
        } else {
          out.push({ ...base, kind: "unsupported", text: "", mediaId: null, mime: null, filename: null, sha256: null });
        }
      }
    }
  }
  return out;
}

export function normalizePhone(waId: string): string {
  const digits = waId.replace(/\D/g, "");
  return digits ? `+${digits}` : waId;
}

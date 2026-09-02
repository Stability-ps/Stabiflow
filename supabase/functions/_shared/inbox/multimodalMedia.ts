// Phase 6 - Multimodal WhatsApp AI. The PURE, framework-free rules that
// decide whether a stored inbound attachment may be handed to the Inbox AI,
// which attachment(s) to send, and how to shape it for the OpenAI Responses
// API. No I/O, no Supabase, no fetch - the webhook wires these to the
// authoritative inbox_messages record and the inbox-media bucket.
// Mirrored (badge labels + status type only) by src/lib/multimodalMedia.ts.
//
// Hard rules encoded here:
//   * only image/jpeg, image/png, image/webp, application/pdf ever reach AI
//   * a per-call AI size cap (< the 12 MB inbound cap) - never feed a huge
//     file to the provider
//   * a model-capability guard - a configured model without vision/file
//     input is handled honestly (not_requested), never a failed attempt
//   * only the CURRENT inbound media is sent by default - old documents are
//     never re-sent on every turn
//   * the storage path is validated against the resolved workspace id - a
//     path is data from the DB record, never trusted blindly

export const AI_MEDIA_MIME_TYPES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

/** AI-processing safety cap - deliberately below whatsappSend.ts's 12 MB
 * inbound cap so a stored-but-large file is not forwarded to the provider. */
export const AI_MEDIA_MAX_BYTES = 8 * 1024 * 1024;

export type AiMediaStatus = "not_requested" | "processed" | "unsupported" | "too_large" | "failed";

/** Only what the decision needs - a subset of an inbox_messages row. */
export type AiMediaMessage = {
  id: string;
  direction: string;
  sender_type: string;
  message_type: string;
  media_mime_type: string | null;
  media_size_bytes: number | null;
  media_storage_path: string | null;
  media_filename?: string | null;
};

export type AiMediaDecision =
  | { eligible: true; mime: string; storagePath: string }
  | { eligible: false; status: Exclude<AiMediaStatus, "processed"> };

/** Is the configured model able to accept image/PDF input on the Responses
 * API? Unknown model -> false (fall back to text-only, honestly), never a
 * doomed attempt. Kept as a small, explicit allow/deny by family. */
export function modelSupportsMultimodal(model: string | null | undefined): boolean {
  const m = (model ?? "").toLowerCase().trim();
  if (!m) return false;
  // Explicitly text-only / no-vision families.
  if (/^(gpt-3\.5|o1-mini|o3-mini|text-|babbage|davinci|ada|curie)/.test(m)) return false;
  if (m === "gpt-4" || /^gpt-4-(0314|0613|1106|32k)/.test(m)) return false;
  // Known image + file capable families on the Responses API.
  if (/^(gpt-4o|chatgpt-4o|gpt-4\.1|gpt-4-turbo|gpt-5|o1|o3|o4)/.test(m)) return true;
  return false;
}

/** Decide whether THIS message's attachment may be sent to the AI. Pure -
 * the caller has already loaded the authoritative record and the workspace
 * opt-in. `workspaceId` is the SERVER-resolved id; the stored path must sit
 * under it or the row is rejected (defence in depth against a bad path). */
export function classifyAiMedia(msg: AiMediaMessage, workspaceId: string): AiMediaDecision {
  const isInboundCustomerMedia =
    msg.direction === "inbound" &&
    msg.sender_type === "customer" &&
    (msg.message_type === "image" || msg.message_type === "document") &&
    !!msg.media_storage_path;
  if (!isInboundCustomerMedia) return { eligible: false, status: "not_requested" };

  const path = msg.media_storage_path as string;
  if (!isStoragePathInWorkspace(path, workspaceId)) return { eligible: false, status: "not_requested" };

  const mime = (msg.media_mime_type ?? "").toLowerCase().trim();
  if (!AI_MEDIA_MIME_TYPES.has(mime)) return { eligible: false, status: "unsupported" };

  const size = typeof msg.media_size_bytes === "number" ? msg.media_size_bytes : null;
  if (size !== null && size > AI_MEDIA_MAX_BYTES) return { eligible: false, status: "too_large" };

  return { eligible: true, mime, storagePath: path };
}

/** inbox-media keys are always `${workspace_id}/${conversation_id}/...`
 * (see whatsapp-webhook upload). A path that does not start with this
 * workspace's own prefix never belongs to it. */
export function isStoragePathInWorkspace(storagePath: string, workspaceId: string): boolean {
  if (!storagePath || !workspaceId) return false;
  if (storagePath.includes("..") || storagePath.startsWith("/")) return false;
  return storagePath.startsWith(`${workspaceId}/`);
}

/** The bounded send policy: by default ONLY the current inbound attachment.
 * Old documents are never re-sent turn after turn (token cost + privacy).
 * `current` is this webhook event's just-stored message. */
export function selectAiMediaMessages(
  current: AiMediaMessage | null,
  workspaceId: string,
): Array<{ message: AiMediaMessage; decision: Extract<AiMediaDecision, { eligible: true }> }> {
  if (!current) return [];
  const decision = classifyAiMedia(current, workspaceId);
  if (!decision.eligible) return [];
  return [{ message: current, decision }];
}

// --- OpenAI Responses API input parts -------------------------------------

export type ImageInputPart = { type: "input_image"; image_url: string };
export type FileInputPart = { type: "input_file"; filename: string; file_data: string };
export type MediaInputPart = ImageInputPart | FileInputPart;

/** base64 data URL - the provider-supported inline form for both image and
 * file input on the Responses API, so nothing is uploaded to a provider
 * file store and no provider file id is ever persisted. */
export function toDataUrl(mime: string, bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export function buildMediaInputPart(mime: string, bytes: Uint8Array, filename: string | null): MediaInputPart {
  const dataUrl = toDataUrl(mime, bytes);
  if (mime === "application/pdf") {
    const safeName = (filename && filename.trim() ? filename.trim() : "document.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
    return { type: "input_file", filename: safeName, file_data: dataUrl };
  }
  return { type: "input_image", image_url: dataUrl };
}

// --- honest response guard ----------------------------------------------

/** When NO attachment was actually given to the model, a reply that claims
 * to have read/seen a document is a hallucination - neutralise it. Cheap
 * regex check alongside the system-prompt rule, same posture as
 * replyGuardrails.containsFalseActionClaim. */
export function claimsToHaveReadMedia(text: string): boolean {
  return /\b(i(?:'ve| have)?\s+(?:reviewed|read|looked at|checked|seen|examined|gone through)|from the|in the|based on the|the attached|the document|the image|the invoice|the file)\b[^.!?]*\b(attach|document|image|invoice|file|pdf|photo|picture|receipt|statement)\b/i
    .test(text) || /\b(i can see|i see)\b[^.!?]*\b(attach|document|image|invoice|file|pdf|photo|picture|receipt)\b/i.test(text);
}

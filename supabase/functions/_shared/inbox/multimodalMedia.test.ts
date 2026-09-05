import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AI_MEDIA_MAX_BYTES,
  buildMediaInputPart,
  classifyAiMedia,
  claimsToHaveReadMedia,
  isStoragePathInWorkspace,
  modelSupportsMultimodal,
  selectAiMediaMessages,
  toDataUrl,
  type AiMediaMessage,
} from "./multimodalMedia.ts";

const WS = "11111111-1111-1111-1111-111111111111";
const OTHER_WS = "22222222-2222-2222-2222-222222222222";
const CONV = "33333333-3333-3333-3333-333333333333";

function msg(over: Partial<AiMediaMessage> = {}): AiMediaMessage {
  return {
    id: "m1",
    direction: "inbound",
    sender_type: "customer",
    message_type: "image",
    media_mime_type: "image/png",
    media_size_bytes: 1024,
    media_storage_path: `${WS}/${CONV}/1700000000-wamid.x-photo.png`,
    media_filename: "photo.png",
    ...over,
  };
}

Deno.test("classifyAiMedia: a supported inbound customer image under this workspace is eligible", () => {
  const d = classifyAiMedia(msg(), WS);
  assertEquals(d.eligible, true);
  if (d.eligible) assertEquals(d.mime, "image/png");
});

Deno.test("classifyAiMedia: a supported PDF is eligible", () => {
  const d = classifyAiMedia(msg({ message_type: "document", media_mime_type: "application/pdf", media_filename: "invoice.pdf", media_storage_path: `${WS}/${CONV}/x-invoice.pdf` }), WS);
  assertEquals(d.eligible, true);
});

Deno.test("classifyAiMedia: an unsupported MIME is rejected as unsupported", () => {
  const d = classifyAiMedia(msg({ media_mime_type: "image/gif" }), WS);
  assertEquals(d.eligible, false);
  if (!d.eligible) assertEquals(d.status, "unsupported");
});

Deno.test("classifyAiMedia: media above the AI size cap is rejected as too_large", () => {
  const d = classifyAiMedia(msg({ media_size_bytes: AI_MEDIA_MAX_BYTES + 1 }), WS);
  assertEquals(d.eligible, false);
  if (!d.eligible) assertEquals(d.status, "too_large");
});

Deno.test("classifyAiMedia: a storage path from another workspace is never eligible", () => {
  const d = classifyAiMedia(msg({ media_storage_path: `${OTHER_WS}/${CONV}/stolen.png` }), WS);
  assertEquals(d.eligible, false);
  if (!d.eligible) assertEquals(d.status, "not_requested");
});

Deno.test("classifyAiMedia: an outbound / staff / non-media message is not_requested", () => {
  assertEquals(classifyAiMedia(msg({ direction: "outbound" }), WS).eligible, false);
  assertEquals(classifyAiMedia(msg({ sender_type: "staff" }), WS).eligible, false);
  assertEquals(classifyAiMedia(msg({ message_type: "text", media_storage_path: null }), WS).eligible, false);
});

Deno.test("isStoragePathInWorkspace: prefix must match; traversal and absolute paths rejected", () => {
  assertEquals(isStoragePathInWorkspace(`${WS}/c/f.png`, WS), true);
  assertEquals(isStoragePathInWorkspace(`${OTHER_WS}/c/f.png`, WS), false);
  assertEquals(isStoragePathInWorkspace(`${WS}/../${OTHER_WS}/f.png`, WS), false);
  assertEquals(isStoragePathInWorkspace(`/etc/passwd`, WS), false);
  assertEquals(isStoragePathInWorkspace("", WS), false);
});

Deno.test("modelSupportsMultimodal: vision-capable families true, text-only / unknown false", () => {
  for (const m of ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-5", "o1", "o3", "gpt-4-turbo"]) {
    assertEquals(modelSupportsMultimodal(m), true, m);
  }
  for (const m of ["gpt-3.5-turbo", "o1-mini", "o3-mini", "gpt-4", "gpt-4-0613", "text-davinci-003", "", "some-future-model", "llama-3"]) {
    assertEquals(modelSupportsMultimodal(m), false, m);
  }
});

Deno.test("selectAiMediaMessages: only the current inbound attachment is ever selected", () => {
  const picked = selectAiMediaMessages(msg(), WS);
  assertEquals(picked.length, 1);
  assertEquals(picked[0].message.id, "m1");
  // no current media -> nothing
  assertEquals(selectAiMediaMessages(null, WS).length, 0);
  // current not eligible -> nothing (never falls back to history)
  assertEquals(selectAiMediaMessages(msg({ media_mime_type: "image/gif" }), WS).length, 0);
});

Deno.test("toDataUrl / buildMediaInputPart: image -> input_image, pdf -> input_file with sanitised filename", () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const url = toDataUrl("image/png", bytes);
  assertEquals(url.startsWith("data:image/png;base64,"), true);

  const img = buildMediaInputPart("image/png", bytes, "photo.png");
  assertEquals(img.type, "input_image");
  if (img.type === "input_image") assertEquals(img.image_url.startsWith("data:image/png;base64,"), true);

  const pdf = buildMediaInputPart("application/pdf", bytes, "my invoice #7.pdf");
  assertEquals(pdf.type, "input_file");
  if (pdf.type === "input_file") {
    assertEquals(pdf.filename, "my_invoice__7.pdf");
    assertEquals(pdf.file_data.startsWith("data:application/pdf;base64,"), true);
  }
});

Deno.test("claimsToHaveReadMedia: flags a fabricated 'I reviewed the invoice' but not a neutral reply", () => {
  assertEquals(claimsToHaveReadMedia("I've reviewed the invoice and the total is R12,500."), true);
  assertEquals(claimsToHaveReadMedia("I can see the document you sent."), true);
  assertEquals(claimsToHaveReadMedia("Thanks for reaching out - how can we help today?"), false);
  assertEquals(claimsToHaveReadMedia("What date do you need payment by?"), false);
});

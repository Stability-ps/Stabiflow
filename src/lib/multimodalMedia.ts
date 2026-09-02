// Phase 6 - Multimodal WhatsApp AI (frontend UX mirror). The webhook +
// supabase/functions/_shared/inbox/multimodalMedia.ts is the source of
// truth for what actually happens; this file only turns the persisted
// inbox_messages.ai_media_status into an honest, human badge for a chat
// bubble. No I/O. Kept in lockstep with the Deno AiMediaStatus union.

export type AiMediaStatus = "not_requested" | "processed" | "unsupported" | "too_large" | "failed";

export const AI_MEDIA_SUPPORTED_FORMATS = {
  images: ["JPEG", "PNG", "WebP"],
  documents: ["PDF"],
} as const;

export type AiMediaBadge = { label: string; tone: "ok" | "muted" | "warn" };

/** A badge is only shown for a state that genuinely tells staff something.
 * null (text message, pre-Phase-6 row, AI never asked, or the workspace has
 * multimodal off) shows nothing - never a guessed state. */
export function aiMediaBadge(status: AiMediaStatus | null | undefined): AiMediaBadge | null {
  switch (status) {
    case "processed":
      return { label: "AI read", tone: "ok" };
    case "failed":
      return { label: "AI couldn't read", tone: "warn" };
    case "unsupported":
      return { label: "Unsupported for AI", tone: "muted" };
    case "too_large":
      return { label: "Too large for AI", tone: "muted" };
    default:
      return null; // not_requested / null -> no badge
  }
}

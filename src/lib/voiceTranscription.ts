// Phase 10 - WhatsApp voice notes (frontend UX mirror). The webhook +
// supabase/functions/_shared/inbox/voiceTranscription.ts is the source of
// truth for what actually happens; this file only turns the persisted
// inbox_messages.transcription_status into an honest chat-bubble hint and
// decides whether a "Retry transcription" control should appear. No I/O.
// Kept in lockstep with the Deno TranscriptionStatus union.

export type TranscriptionStatus =
  | "not_requested" | "pending" | "processed" | "failed" | "too_large" | "unsupported" | "skipped_quota";

export type TranscriptionHint = { label: string; tone: "ok" | "muted" | "warn" };

/** A hint is shown only for a state that tells staff something real. null /
 * not_requested (transcription off, or not a voice note) shows nothing. The
 * transcript text itself is rendered separately and always labelled
 * "Transcript" - never as the customer's verbatim words. */
export function transcriptionHint(status: TranscriptionStatus | null | undefined): TranscriptionHint | null {
  switch (status) {
    case "pending":
      return { label: "Transcribing…", tone: "muted" };
    case "processed":
      return { label: "Auto-transcribed · may contain errors", tone: "muted" };
    case "failed":
      return { label: "Couldn't transcribe", tone: "warn" };
    case "too_large":
      return { label: "Too long to transcribe", tone: "muted" };
    case "unsupported":
      return { label: "Audio format can't be transcribed", tone: "muted" };
    case "skipped_quota":
      return { label: "Transcription skipped (usage limit)", tone: "warn" };
    default:
      return null; // not_requested / null -> no hint
  }
}

/** A manual retry only makes sense when a transcript was wanted but not
 * produced, for a viewer who holds inbox.manage. */
export function canRetryTranscription(status: TranscriptionStatus | null | undefined, canManageInbox: boolean): boolean {
  return canManageInbox && (status === "failed" || status === "skipped_quota");
}

export function isAudioMessage(mimeType: string | null | undefined): boolean {
  return !!mimeType && mimeType.toLowerCase().startsWith("audio/");
}

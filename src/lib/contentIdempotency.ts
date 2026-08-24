// Frontend copy of the idempotency-key algorithm, used only by the
// reschedule flow: changing scheduled_at means the key must change too
// (it's part of the hash input), and rescheduling is a direct client
// UPDATE (RLS-gated by content.edit) rather than a round trip through an
// edge function - matching Acapolite's original ReschedulePostDialog
// pattern, which rebuilt the key the same way.
//
// The AUTHORITATIVE copy lives in
// supabase/functions/_shared/contentIdempotency.ts and is what the unique
// constraint on content_scheduled_posts.idempotency_key actually enforces;
// this file must stay byte-for-byte identical in algorithm or a
// client-computed key would silently diverge from a server-computed one
// for the same logical slot.
export type IdempotencyInput = {
  workspaceId: string;
  seriesId: string | null;
  mediaAssetId: string;
  targetPlatform: string;
  destinationId: string;
  scheduledAt: Date;
};

export async function buildIdempotencyKey(input: IdempotencyInput): Promise<string> {
  const canonical = [
    input.workspaceId,
    input.seriesId ?? "",
    input.mediaAssetId,
    input.targetPlatform,
    input.destinationId,
    input.scheduledAt.toISOString(),
  ].join("|");
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Deterministic idempotency key for a single scheduled post. Same
// (workspace, series, media asset, platform, destination account,
// scheduled instant) always produces the same key - this is what the
// database UNIQUE constraint on content_scheduled_posts.idempotency_key
// actually enforces, so a schedule regeneration can never insert a
// duplicate row for the same slot, and two concurrent activation attempts
// collapse onto the same key instead of creating two rows.
//
// Adapted from Acapolite's _shared/socialIdempotency.ts: workspaceId was
// added to the hash input (two workspaces independently scheduling the
// same media asset id at the same instant must never collide), and
// socialAccountId became destinationId (workspace_facebook_pages.id or
// workspace_instagram_accounts.id - whichever this post targets). seriesId
// is nullable, matching content_scheduled_posts.series_id, for the ad-hoc
// single-post flow that has no series at all.

export type IdempotencyInput = {
  workspaceId: string;
  seriesId: string | null;
  mediaAssetId: string;
  targetPlatform: string;
  destinationId: string;
  scheduledAt: Date;
};

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildIdempotencyKey(input: IdempotencyInput): Promise<string> {
  const canonical = [
    input.workspaceId,
    input.seriesId ?? "",
    input.mediaAssetId,
    input.targetPlatform,
    input.destinationId,
    input.scheduledAt.toISOString(),
  ].join("|");
  return sha256Hex(canonical);
}

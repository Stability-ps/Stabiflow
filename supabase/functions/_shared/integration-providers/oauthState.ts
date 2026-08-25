// OAuth state generation + validation (Phase C instruction #29/#30).
//
// The state row itself (workspace_id, provider, user_id, expires_at,
// used_at) always lives server-side in
// workspace_integration_oauth_states - this module only holds the pure,
// unit-testable predicate for "is this state row still usable", plus the
// random state-value generator. The callback function is responsible for
// atomically claiming the row (UPDATE ... WHERE used_at IS NULL RETURNING)
// so validation and single-use consumption happen together.

export function generateOauthState(): string {
  // 32 random bytes, hex-encoded - unguessable and URL-safe.
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type OauthStateRow = {
  expires_at: string; // ISO
  used_at: string | null;
};

// Pure so it can be unit tested without a database: given a state row and
// "now", is it still eligible to be claimed? A row already claimed
// (used_at set) or past its expiry is never valid, regardless of how it
// got that way (a previous successful callback, a replay attempt, or
// simple staleness).
export function isOauthStateValid(row: OauthStateRow, nowIso: string): boolean {
  if (row.used_at !== null) return false;
  return new Date(row.expires_at).getTime() > new Date(nowIso).getTime();
}

// WhatsApp/Meta webhook signature verification (Phase C instruction #14).
// Preserves the Acapolite pattern of a constant-time comparison
// (content-publish-worker/index.ts's timingSafeEqual) applied to an
// HMAC-SHA256 of the raw request body, keyed by the Meta App Secret -
// exactly Meta's documented X-Hub-Signature-256 verification scheme.

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// header is the raw `X-Hub-Signature-256` value, e.g. "sha256=abcdef...".
// Returns false (never throws) for any malformed/missing header - callers
// must treat "not verified" as "reject", not "assume valid".
export async function verifyMetaWebhookSignature(appSecret: string, rawBody: string, header: string | null): Promise<boolean> {
  if (!header || !header.startsWith("sha256=")) return false;
  const provided = header.slice("sha256=".length).toLowerCase();
  const expected = await hmacSha256Hex(appSecret, rawBody);
  return timingSafeEqual(provided, expected);
}

// GET verification-challenge handshake (Meta calls this once when the
// webhook URL is configured in the App dashboard).
export function verifyWebhookChallenge(input: {
  mode: string | null;
  verifyToken: string | null;
  expectedVerifyToken: string;
  challenge: string | null;
}): string | null {
  if (input.mode !== "subscribe") return null;
  if (!input.verifyToken || !timingSafeEqual(input.verifyToken, input.expectedVerifyToken)) return null;
  return input.challenge;
}

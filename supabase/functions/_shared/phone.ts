// Phone normalization shared by the Leads module (Phase E) and available
// for the Inbox module to adopt later - kept independent of
// _shared/inbox/webhookMessageParser.ts's normalizePhone (same digits-only
// -> "+digits" logic) rather than importing across module boundaries, and
// deliberately conservative: an unknown/incomplete number is returned
// unchanged rather than guessed at (durable rule #25 - never rewrite an
// incomplete number into something that looks more correct than it is).

export function normalizePhoneNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  const digitsOnly = digits.replace(/\D/g, "");
  if (digitsOnly.length < 7) return null; // too short to be a real, matchable phone number
  return `+${digitsOnly}`;
}

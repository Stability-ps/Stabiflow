// Client-side mirror of supabase/functions/_shared/phone.ts (Deno can't
// share a module with the Vite/React bundle, so this is intentionally
// duplicated rather than imported across runtimes - see that file's
// header comment). Used for a live preview when a staff member types a
// phone number into the manual lead form; the edge function's own copy is
// the actual source of truth for what gets stored.
export function normalizePhoneNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  const digitsOnly = digits.replace(/\D/g, "");
  if (digitsOnly.length < 7) return null;
  return `+${digitsOnly}`;
}

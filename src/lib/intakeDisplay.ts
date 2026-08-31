// Phase 2: render a lead's / conversation's intake payload as
// human-readable label/value rows. The payload is a flat key/value bag
// today (Phase 3 introduces a real workspace-configurable schema with
// labels). Until then this turns snake_case keys into sentence case and
// formats scalar values - never dumps raw JSON at the user.
//
// Pure and framework-free so it can be unit tested and reused by both the
// Lead detail and the Conversation CRM panel.

export type IntakeRow = { key: string; label: string; value: string };

// Keys that are pure plumbing / already shown elsewhere on the record, or
// that carry no user value on their own.
const HIDDEN_KEYS = new Set(["schema_id", "source", "phone", "wa_id", "whatsapp_display_name"]);

function toLabel(key: string): string {
  const cleaned = key.replace(/[_-]+/g, " ").trim();
  if (!cleaned) return key;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function formatScalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    const parts = value.map(formatScalar).filter((v): v is string => v != null);
    return parts.length ? parts.join(", ") : null;
  }
  // A nested object - Phase 3's structured shape { value, state, ... }.
  if (value && typeof value === "object") {
    const inner = (value as Record<string, unknown>).value;
    if (inner !== undefined) return formatScalar(inner);
    return null;
  }
  return null;
}

/** Turn an intake payload into displayable rows. Empty / hidden / unset
 * entries are dropped, so an empty payload yields an empty array (callers
 * should then render nothing, not an empty shell). */
export function intakeRows(payload: unknown): IntakeRow[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const record = payload as Record<string, unknown>;

  // Phase 3 forward-compat: if a { fields: {...} } shape is present, read
  // from it; otherwise treat the object itself as the flat bag.
  const source = record.fields && typeof record.fields === "object" && !Array.isArray(record.fields)
    ? (record.fields as Record<string, unknown>)
    : record;

  const rows: IntakeRow[] = [];
  for (const [key, raw] of Object.entries(source)) {
    if (HIDDEN_KEYS.has(key)) continue;
    const value = formatScalar(raw);
    if (value == null) continue;
    rows.push({ key, label: toLabel(key), value });
  }
  return rows;
}

export function hasDisplayableIntake(payload: unknown): boolean {
  return intakeRows(payload).length > 0;
}

export function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Phase 2 - Conversation -> CRM completion. The PURE rules for carrying a
// conversation's AI-collected context onto a lead, kept independently
// testable (same pattern as _shared/leadMatching in the frontend and
// _shared/inbox/webhookMessageParser here). leads-actions/index.ts wraps
// these with the actual Supabase reads/writes.
//
// Hard rules encoded here:
//   - never fabricate a summary
//   - never overwrite a non-empty lead summary except on an explicit opt-in
//   - merge intake so EXISTING lead keys always win (staff may have curated them)
//   - only map an intake value into a typed lead column when it is
//     UNAMBIGUOUS and that column is currently empty; a "budget"/"amount"
//     with no clear currency is NOT unambiguous

export const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// leads.estimated_value is numeric(14,2): max 999_999_999_999.99 (< 1e12).
const MAX_ESTIMATED_VALUE = 1e12;

export function asIntakeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Phase 3: an intake payload may now be the structured shape
 * { schema_id, fields: {...} } or a Phase-2 flat bag. This returns the flat
 * answer view for typed-column mapping; the full object is still what gets
 * stored on leads.intake (schema_id + fields preserved). */
export function intakeFieldsView(intake: unknown): Record<string, unknown> {
  const record = asIntakeRecord(intake);
  const inner = record.fields;
  return inner && typeof inner === "object" && !Array.isArray(inner) ? (inner as Record<string, unknown>) : record;
}

// --- deep merge (Phase 2 remediation M4) ----------------------------------
// EXISTING lead values always win. Conversation intake only fills keys the
// lead does not already have, recursively. Arrays are atomic - existing
// wins if present, otherwise the conversation array is copied; never an
// element-wise merge. Prototype-pollution keys are dropped, non-plain
// objects are not recursed into, and recursion is depth-capped.

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_MERGE_DEPTH = 8;
// F2: comfortably above MAX_MERGE_DEPTH and any realistic intake, so a
// pathologically deep stored intake can never blow the stack here.
const STRINGIFY_MAX_DEPTH = 40;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function deepMergePreferExisting(existing: unknown, incoming: unknown, depth = 0): unknown {
  if (!isPlainObject(existing) || !isPlainObject(incoming) || depth >= MAX_MERGE_DEPTH) {
    // Existing wins whenever the lead has anything here at all; only fall
    // back to the conversation value when the lead key is genuinely absent.
    return existing === undefined ? incoming : existing;
  }
  // F3: never carry a prototype-pollution key forward from EITHER side.
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(existing)) {
    if (!DANGEROUS_KEYS.has(key)) out[key] = existing[key];
  }
  for (const key of Object.keys(incoming)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    if (!(key in out)) {
      out[key] = incoming[key];
    } else if (isPlainObject(out[key]) && isPlainObject(incoming[key])) {
      out[key] = deepMergePreferExisting(out[key], incoming[key], depth + 1);
    }
    // otherwise: existing scalar / array / other value wins - leave as-is
  }
  return out;
}

/** F3: recursively strip prototype-pollution keys from a plain-object /
 * array structure so BOTH the initial conversion copy and the merge path
 * store the same sanitized shape. Non-plain objects are dropped to `null`.
 * Depth-capped: past the cap a subtree is passed through untouched (it is
 * already jsonb-round-tripped data, and the cap is far beyond real intake). */
export function sanitizeIntakeValue(value: unknown, depth = 0): unknown {
  if (depth >= STRINGIFY_MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((v) => sanitizeIntakeValue(v, depth + 1));
  if (value !== null && typeof value === "object") {
    if (!isPlainObject(value)) return null;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      out[key] = sanitizeIntakeValue((value as Record<string, unknown>)[key], depth + 1);
    }
    return out;
  }
  return value;
}

/** asIntakeRecord + F3 sanitization - the single entry point for turning a
 * conversation's raw intake_payload into something safe to store/merge. */
export function sanitizeIntake(value: unknown): Record<string, unknown> {
  return sanitizeIntakeValue(asIntakeRecord(value)) as Record<string, unknown>;
}

/** Order-insensitive structural stringify, for cheap deep-equality.
 * F2: depth-capped - past the cap two subtrees compare equal (a change
 * that deep is impossible: deepMergePreferExisting stops recursing at
 * MAX_MERGE_DEPTH and keeps the existing reference below it). */
export function stableStringify(value: unknown, depth = 0): string {
  if (depth >= STRINGIFY_MAX_DEPTH) return '"[deep]"';
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v, depth + 1)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k], depth + 1)}`).join(",")}}`;
}

export type ExistingTypedLeadFields = {
  contact_name: string | null;
  email: string | null;
  company_name: string | null;
  estimated_value: number | null;
};

/** Map ONLY unambiguous intake values into empty typed lead columns. */
export function safeTypedLeadFields(
  intake: Record<string, unknown>,
  existing: ExistingTypedLeadFields,
): { patch: Record<string, unknown>; mapped: string[] } {
  const patch: Record<string, unknown> = {};
  const mapped: string[] = [];

  if (existing.contact_name == null) {
    const name = typeof intake.contact_name === "string" ? intake.contact_name.trim()
      : typeof intake.customer_name === "string" ? intake.customer_name.trim() : "";
    if (name && name.length <= 200) { patch.contact_name = name; mapped.push("contact_name"); }
  }
  if (existing.email == null) {
    const email = typeof intake.email === "string" ? intake.email.trim().toLowerCase() : "";
    if (email && email.length <= 320 && EMAIL_SHAPE.test(email)) { patch.email = email; mapped.push("email"); }
  }
  if (existing.company_name == null) {
    const company = typeof intake.company_name === "string" ? intake.company_name.trim() : "";
    if (company && company.length <= 200) { patch.company_name = company; mapped.push("company_name"); }
  }
  if (existing.estimated_value == null) {
    // Strict on purpose: only a key literally named estimated_value that is
    // already a finite non-negative number. "budget"/"amount" are NOT
    // mapped - currency & units are ambiguous, guessing corrupts revenue.
    // F6: also bounded to what leads.estimated_value numeric(14,2) holds -
    // a larger value would overflow and 500 the whole conversion.
    const ev = intake.estimated_value;
    if (typeof ev === "number" && Number.isFinite(ev) && ev >= 0 && ev < MAX_ESTIMATED_VALUE) { patch.estimated_value = ev; mapped.push("estimated_value"); }
  }
  return { patch, mapped };
}

export type SummaryIntakeDecision = {
  patch: { summary?: string; intake?: Record<string, unknown> };
  summary_copied: boolean;
  summary_overwritten: boolean;
  summary_skipped: boolean;
  /** Top-level keys the conversation contributed that the lead lacked. */
  intake_new_keys: string[];
  /** True when the deep merge changed anything (incl. a nested-only add). */
  intake_changed: boolean;
};

/** Decide what (if anything) to write to an EXISTING lead's summary/intake
 * from a conversation. No DB access - the caller applies `patch`. */
export function resolveSummaryAndIntake(
  lead: { summary: string | null; intake: unknown },
  conversationAiSummary: string | null,
  conversationIntake: Record<string, unknown>,
  opts: { overwriteSummary?: boolean } = {},
): SummaryIntakeDecision {
  const existingSummary = typeof lead.summary === "string" ? lead.summary.trim() : "";
  const aiSummary = typeof conversationAiSummary === "string" ? conversationAiSummary.trim() : "";

  const patch: { summary?: string; intake?: Record<string, unknown> } = {};
  let summary_copied = false;
  let summary_overwritten = false;
  let summary_skipped = false;

  if (aiSummary) {
    if (!existingSummary) { patch.summary = aiSummary.slice(0, 2000); summary_copied = true; }
    else if (opts.overwriteSummary && aiSummary !== existingSummary) { patch.summary = aiSummary.slice(0, 2000); summary_overwritten = true; }
    else if (aiSummary !== existingSummary) { summary_skipped = true; }
  }

  const existingIntake = asIntakeRecord(lead.intake);
  const intake_new_keys = Object.keys(conversationIntake).filter((k) => !(k in existingIntake));
  const merged = deepMergePreferExisting(existingIntake, conversationIntake) as Record<string, unknown>;
  const intake_changed = stableStringify(merged) !== stableStringify(existingIntake);
  if (intake_changed) patch.intake = merged; // deep merge, existing values always win

  return { patch, summary_copied, summary_overwritten, summary_skipped, intake_new_keys, intake_changed };
}

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

export function asIntakeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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
    const ev = intake.estimated_value;
    if (typeof ev === "number" && Number.isFinite(ev) && ev >= 0) { patch.estimated_value = ev; mapped.push("estimated_value"); }
  }
  return { patch, mapped };
}

export type SummaryIntakeDecision = {
  patch: { summary?: string; intake?: Record<string, unknown> };
  summary_copied: boolean;
  summary_overwritten: boolean;
  summary_skipped: boolean;
  intake_new_keys: string[];
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
  if (intake_new_keys.length > 0) patch.intake = { ...conversationIntake, ...existingIntake }; // existing keys win

  return { patch, summary_copied, summary_overwritten, summary_skipped, intake_new_keys };
}

// Pure template-eligibility and parameter validation (Phase L-1) - kept
// deliberately simple (V1 focuses on discover/select/validate/send, never
// a full template builder): counts the {{n}} placeholders in a template's
// own BODY component (Meta's own stored structure, synced verbatim - see
// the whatsapp_message_templates migration) and checks the caller supplied
// exactly that many parameters. No type/format validation beyond
// presence/count - Meta itself validates the actual parameter content at
// send time and returns a classifiable error if it rejects one (see
// metaGraphError.ts), so this only catches the cheap, deterministic
// mismatch before ever making that call.
export type TemplateComponent = { type?: string; text?: string; [key: string]: unknown };

export type TemplateEligibilityError =
  | { code: "not_found" }
  | { code: "not_approved"; status: string }
  | { code: "parameter_count_mismatch"; expected: number; received: number }
  | { code: "missing_language" };

export type TemplateEligibilityResult = { ok: true; requiredParameterCount: number } | { ok: false; error: TemplateEligibilityError };

// Meta's placeholder syntax is {{1}}, {{2}}, ... in order - the count of
// DISTINCT numbers referenced is the number of body parameters a send
// must supply, regardless of how many times a given number repeats.
export function countBodyParameters(components: TemplateComponent[]): number {
  const body = components.find((c) => (c.type || "").toUpperCase() === "BODY");
  if (!body || typeof body.text !== "string") return 0;
  const matches = body.text.match(/\{\{\s*(\d+)\s*\}\}/g) || [];
  const numbers = new Set(matches.map((m) => m.replace(/[^\d]/g, "")));
  return numbers.size;
}

export function validateTemplateEligibility(
  template: { provider_status: string; language: string; components: TemplateComponent[] } | null,
  providedParameterCount: number,
): TemplateEligibilityResult {
  if (!template) return { ok: false, error: { code: "not_found" } };
  if (template.provider_status !== "APPROVED") return { ok: false, error: { code: "not_approved", status: template.provider_status } };
  if (!template.language) return { ok: false, error: { code: "missing_language" } };
  const requiredParameterCount = countBodyParameters(template.components);
  if (providedParameterCount !== requiredParameterCount) {
    return { ok: false, error: { code: "parameter_count_mismatch", expected: requiredParameterCount, received: providedParameterCount } };
  }
  return { ok: true, requiredParameterCount };
}

// Human-readable, never leaks a token/secret - safe to return directly in
// an API response (see the edge function's use of this).
export function describeTemplateEligibilityError(error: TemplateEligibilityError): string {
  switch (error.code) {
    case "not_found":
      return "This template does not exist in this workspace.";
    case "not_approved":
      return `This template is not approved for sending (current status: ${error.status}).`;
    case "parameter_count_mismatch":
      return `This template requires ${error.expected} parameter(s), but ${error.received} were provided.`;
    case "missing_language":
      return "This template has no language configured.";
    default:
      return "This template cannot be used.";
  }
}

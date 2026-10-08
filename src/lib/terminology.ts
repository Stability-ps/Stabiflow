// Reads workspace_settings.terminology (existing jsonb column, unused
// until now - durable rule #12: the underlying `opportunities` table
// never gets renamed per workspace, only its UI label does). Shape is
// intentionally open/untyped at the DB layer (same reason
// business-profile fields were NOT folded into it); this module is the
// one place that knows the specific key Leads/Opportunities UI reads.
export type WorkspaceTerminology = { opportunity_label?: string } & Record<string, unknown>;

const DEFAULT_OPPORTUNITY_LABEL = "Opportunity";

export function getOpportunityLabel(terminology: WorkspaceTerminology | null | undefined): string {
  const custom = terminology?.opportunity_label;
  return typeof custom === "string" && custom.trim() ? custom.trim() : DEFAULT_OPPORTUNITY_LABEL;
}

export function openOpportunityActionLabel(terminology: WorkspaceTerminology | null | undefined): string {
  return `Open ${getOpportunityLabel(terminology)}`;
}

export function createOpportunityActionLabel(terminology: WorkspaceTerminology | null | undefined): string {
  return `Create ${getOpportunityLabel(terminology)}`;
}

// Naive English pluralization, sufficient for the short single-word/short-
// phrase labels this module deals with (Opportunity, Request, Deal,
// Booking, Application, Case, ...) - a plain "+ s" turns "Opportunity"
// into "Opportunitys", so this is worth a real (if small) rule rather than
// string concatenation at each call site.
export function pluralizeLabel(label: string): string {
  if (/[^aeiou]y$/i.test(label)) return `${label.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(label)) return `${label}es`;
  return `${label}s`;
}

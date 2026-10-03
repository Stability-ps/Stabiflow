export type QualificationStatus = "unqualified" | "qualifying" | "qualified" | "not_qualified";

export const QUALIFICATION_STATUSES: QualificationStatus[] = ["unqualified", "qualifying", "qualified", "not_qualified"];

export function qualificationStatusLabel(status: QualificationStatus): string {
  switch (status) {
    case "unqualified": return "Unqualified";
    case "qualifying": return "Qualifying";
    case "qualified": return "Qualified";
    case "not_qualified": return "Not qualified";
  }
}

// The one rule V1 qualification enforces (durable rule #7): marking a lead
// "not_qualified" without saying why is a dead end nobody can act on later
// - everything else is a free transition (a lead can move back and forth
// between unqualified/qualifying/qualified as staff learn more, no rigid
// forward-only state machine imposed here, unlike delivery-status).
export function validateQualificationChange(status: QualificationStatus, reason: string | null | undefined): string | null {
  if (status === "not_qualified" && !reason?.trim()) {
    return "A reason is required when marking a lead not qualified.";
  }
  return null;
}

export type OpportunityStatus = "open" | "won" | "lost";

// Won/lost are terminal outcomes (durable rule #15): once marked, an
// opportunity does not silently flip to the other terminal state - a
// mistaken "won" gets reopened back to "open" first (an explicit,
// auditable step), then re-closed as lost if that's what actually
// happened. Records are never deleted either way.
export function canTransitionOpportunityStatus(from: OpportunityStatus, to: OpportunityStatus): boolean {
  if (from === to) return false;
  if (from === "open") return to === "won" || to === "lost";
  if (from === "won" || from === "lost") return to === "open"; // reopen only, not won<->lost directly
  return false;
}

export function opportunityStatusLabel(status: OpportunityStatus): string {
  switch (status) {
    case "open": return "Open";
    case "won": return "Won";
    case "lost": return "Lost";
  }
}

// Loop prevention (pure, testable without a database). Two independent
// guards: a direct cycle (this event was produced by the SAME automation
// we're about to trigger again) is refused outright regardless of depth;
// a causation chain that has simply gone too deep (A -> B -> A -> B ...)
// is refused once it crosses MAX_CAUSATION_DEPTH, even if no single hop
// repeats an automation id.
export const MAX_CAUSATION_DEPTH = 5;

export type LoopGuardInput = {
  eventCausedByAutomationId: string | null;
  eventCausationDepth: number;
};

export type LoopGuardResult = { allowed: true } | { allowed: false; reason: string };

export function checkLoopGuard(event: LoopGuardInput, candidateAutomationId: string): LoopGuardResult {
  if (event.eventCausedByAutomationId === candidateAutomationId) {
    return { allowed: false, reason: "This event was produced by this same automation's own action - refusing to re-trigger it (direct cycle)." };
  }
  if (event.eventCausationDepth >= MAX_CAUSATION_DEPTH) {
    return { allowed: false, reason: `Causation depth (${event.eventCausationDepth}) has reached the maximum (${MAX_CAUSATION_DEPTH}) - refusing to trigger further automations from this chain.` };
  }
  return { allowed: true };
}

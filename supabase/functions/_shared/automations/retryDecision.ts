// Pure retry/backoff decision logic for automation_runs - deliberately the
// SAME shape and backoff curve as
// _shared/contentPublishDecision.ts's decideNextState (already proven and
// unit-tested in this codebase), not a new invented schedule. Kept
// separate from the actual action-execution code so it stays testable
// without a database or a live dispatcher call.
export const MAX_RUN_ATTEMPTS = 5;
const BACKOFF_MINUTES = [2, 5, 15, 60, 180];

export type RunOutcome =
  | { kind: "success" }
  | { kind: "partial" } // some steps succeeded, a later step failed - not retried automatically, needs manual retry
  | { kind: "temporary_failure"; code: string; message: string }
  | { kind: "permanent_failure"; code: string; message: string };

export type RunState = { attemptCount: number };

export type NextRunState =
  | { status: "succeeded"; attemptCount: number; nextRetryAt: null }
  | { status: "partial"; attemptCount: number; nextRetryAt: null }
  | { status: "failed"; attemptCount: number; nextRetryAt: null }
  | { status: "pending"; attemptCount: number; nextRetryAt: Date };

export function decideNextRunState(current: RunState, outcome: RunOutcome, now: Date): NextRunState {
  const attemptCount = current.attemptCount + 1;

  if (outcome.kind === "success") return { status: "succeeded", attemptCount, nextRetryAt: null };
  if (outcome.kind === "partial") return { status: "partial", attemptCount, nextRetryAt: null };
  if (outcome.kind === "permanent_failure") return { status: "failed", attemptCount, nextRetryAt: null };

  // temporary_failure
  if (attemptCount >= MAX_RUN_ATTEMPTS) return { status: "failed", attemptCount, nextRetryAt: null };
  const backoffMinutes = BACKOFF_MINUTES[Math.min(attemptCount - 1, BACKOFF_MINUTES.length - 1)];
  return { status: "pending", attemptCount, nextRetryAt: new Date(now.getTime() + backoffMinutes * 60 * 1000) };
}

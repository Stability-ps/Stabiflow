// Pure retry/backoff decision logic for the content publish worker, kept
// separate from the actual provider API calls so it can be unit tested
// without a network dependency or a live provider mock server.
//
// Ported unchanged from Acapolite's _shared/socialPublishDecision.ts.

export const MAX_PUBLISH_ATTEMPTS = 5;

// Exponential backoff in minutes, capped. Attempt 1 fails -> wait 2 min
// before attempt 2 is eligible; attempt 2 fails -> wait 5 min; etc.
const BACKOFF_MINUTES = [2, 5, 15, 60, 180];

export type PublishOutcome =
  | { kind: "success"; providerPostId: string; permalink: string | null }
  | { kind: "temporary_failure"; code: string; message: string }
  | { kind: "permanent_failure"; code: string; message: string };

export type ScheduledPostState = {
  attemptCount: number;
  status: string;
};

export type NextState =
  | { status: "published"; publishedAt: Date; providerPostId: string; providerPermalink: string | null; attemptCount: number; nextRetryAt: null; failureCode: null; failureMessage: null }
  | { status: "scheduled"; nextRetryAt: Date; attemptCount: number; failureCode: string; failureMessage: string }
  | { status: "failed"; attemptCount: number; failureCode: string; failureMessage: string; nextRetryAt: null };

// Permanent (never auto-retried) vs temporary (retried with backoff) is
// decided by the provider adapter via the `kind` on PublishOutcome - this
// function only decides what state transition follows from that verdict,
// so the classification rule lives in one place per provider (see
// content-providers/*.ts) and the backoff/give-up arithmetic lives here,
// shared by every provider.
export function decideNextState(current: ScheduledPostState, outcome: PublishOutcome, now: Date): NextState {
  const attemptCount = current.attemptCount + 1;

  if (outcome.kind === "success") {
    return {
      status: "published",
      publishedAt: now,
      providerPostId: outcome.providerPostId,
      providerPermalink: outcome.permalink,
      attemptCount,
      nextRetryAt: null,
      failureCode: null,
      failureMessage: null,
    };
  }

  if (outcome.kind === "permanent_failure") {
    return { status: "failed", attemptCount, failureCode: outcome.code, failureMessage: outcome.message, nextRetryAt: null };
  }

  // temporary_failure
  if (attemptCount >= MAX_PUBLISH_ATTEMPTS) {
    return { status: "failed", attemptCount, failureCode: outcome.code, failureMessage: `${outcome.message} (max retries exhausted)`, nextRetryAt: null };
  }
  const backoffMinutes = BACKOFF_MINUTES[Math.min(attemptCount - 1, BACKOFF_MINUTES.length - 1)];
  const nextRetryAt = new Date(now.getTime() + backoffMinutes * 60 * 1000);
  return { status: "scheduled", nextRetryAt, attemptCount, failureCode: outcome.code, failureMessage: outcome.message };
}

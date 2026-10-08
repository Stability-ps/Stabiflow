// Pure subscription lifecycle decisions for the reconcile tick. No I/O.
// The database function billing_transition_subscription enforces the
// legal-transition matrix; this module decides WHICH transition time has
// made due.

export type SubscriptionStatus = "incomplete" | "active" | "past_due" | "grace" | "cancelled" | "expired";

export type SubscriptionSnapshot = {
  id: string;
  status: SubscriptionStatus;
  current_period_end: string | null;
  grace_until: string | null;
  created_at: string;
};

export type LifecycleDecision = { to: SubscriptionStatus; reason: string; graceUntil?: string } | null;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Paystack renews on the period end date; allow a day for the renewal webhook to land before acting. */
export const RENEWAL_SETTLE_MS = DAY_MS;
/** An unpaid checkout-created subscription is abandoned after this long. */
export const INCOMPLETE_EXPIRY_MS = 2 * DAY_MS;

export function decideLifecycle(sub: SubscriptionSnapshot, now: Date, graceDays: number): LifecycleDecision {
  const t = now.getTime();
  const periodEnd = sub.current_period_end ? Date.parse(sub.current_period_end) : null;

  switch (sub.status) {
    case "incomplete":
      return t - Date.parse(sub.created_at) > INCOMPLETE_EXPIRY_MS ? { to: "expired", reason: "Checkout was never paid" } : null;
    case "active":
    case "past_due":
      if (periodEnd !== null && t > periodEnd + RENEWAL_SETTLE_MS) {
        const graceUntil = new Date(periodEnd + Math.max(0, graceDays) * DAY_MS);
        if (graceUntil.getTime() <= t) return { to: "expired", reason: "Renewal not paid and grace period elapsed" };
        return { to: "grace", reason: "Renewal not paid - grace period started", graceUntil: graceUntil.toISOString() };
      }
      return null;
    case "grace":
      return sub.grace_until && Date.parse(sub.grace_until) <= t ? { to: "expired", reason: "Grace period elapsed without payment" } : null;
    case "cancelled":
      return periodEnd === null || periodEnd <= t ? { to: "expired", reason: "Cancelled subscription reached the end of its paid period" } : null;
    default:
      return null;
  }
}

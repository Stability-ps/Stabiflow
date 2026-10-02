// Billing reconciliation, every 15 minutes via pg_cron (see
// 20261014060000_paystack_billing.sql). Shared-secret header, no user.
//
//  1. Time-based subscription lifecycle: active/past_due past their period
//     -> grace -> expired; cancelled past period -> expired; never-paid
//     checkouts -> expired. Decided by the pure decideLifecycle(), applied
//     through billing_transition_subscription (legal transitions only).
//  2. Pending checkouts: ask Paystack for the real status of initialized
//     transactions older than a few minutes (covers a lost webhook) and
//     apply success through the same atomic path; mark long-abandoned ones.
import { createServiceClient } from "../_shared/contentAuth.ts";
import { paystackConfigFromEnv, timingSafeEqualHex, verifyTransaction } from "../_shared/billing/paystack.ts";
import { processPaystackEvent } from "../_shared/billing/processPaystackEvent.ts";
import { sendBillingEmailForEvent } from "../_shared/billing/billingEmail.ts";
import { decideLifecycle, type SubscriptionSnapshot } from "../_shared/billing/subscriptionLifecycle.ts";

const SUB_BATCH = 200;
const TXN_BATCH = 50;
const VERIFY_AFTER_MINUTES = 5;

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get("BILLING_CRON_SECRET")?.trim();
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (!secret || !timingSafeEqualHex(secret, provided)) return reply({ error: "Forbidden" }, 403);

  const sb = createServiceClient();
  const cfg = paystackConfigFromEnv();
  const now = new Date();
  const summary = { transitions: 0, verified: 0, abandoned: 0, errors: [] as string[] };

  const { data: graceSetting } = await sb.from("platform_settings").select("value").eq("key", "billing.grace_days").maybeSingle();
  const graceDays = Number(graceSetting?.value ?? 7) || 7;
  const { data: abandonSetting } = await sb.from("platform_settings").select("value").eq("key", "billing.pending_abandon_hours").maybeSingle();
  const abandonHours = Number(abandonSetting?.value ?? 24) || 24;

  // 1. Lifecycle.
  const { data: subs } = await sb
    .from("workspace_subscriptions")
    .select("id, status, current_period_end, grace_until, created_at")
    .in("status", ["incomplete", "active", "past_due", "grace", "cancelled"])
    .order("updated_at", { ascending: true })
    .limit(SUB_BATCH);
  for (const sub of (subs ?? []) as SubscriptionSnapshot[]) {
    const decision = decideLifecycle(sub, now, graceDays);
    if (!decision) continue;
    const { data: ok, error } = await sb.rpc("billing_transition_subscription", {
      p_subscription_id: sub.id, p_expected_from: sub.status, p_to: decision.to, p_reason: decision.reason, p_actor: "reconcile",
      p_grace_until: decision.graceUntil ?? null,
    });
    if (error) summary.errors.push(`sub ${sub.id}: ${error.message}`);
    else if (ok === true) summary.transitions++;
  }

  // 2. Pending checkouts.
  if (cfg.secretKey || cfg.mockMode) {
    const cutoff = new Date(now.getTime() - VERIFY_AFTER_MINUTES * 60_000).toISOString();
    const { data: pending } = await sb
      .from("billing_transactions")
      .select("reference, amount_minor, currency, created_at, purchase_id")
      .eq("status", "initialized")
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(TXN_BATCH);
    for (const txn of (pending ?? []) as { reference: string; amount_minor: number; currency: string; created_at: string; purchase_id: string | null }[]) {
      try {
        // Mock mode must never auto-succeed a checkout nobody paid for.
        const verified = cfg.mockMode ? { status: "abandoned", amount: 0, currency: txn.currency, paid_at: null } : await verifyTransaction(cfg, txn.reference);
        if (verified.status === "success") {
          const verifiedEvent = { event: "charge.success", data: { reference: txn.reference, amount: verified.amount, currency: verified.currency, paid_at: verified.paid_at } };
          const outcome = await processPaystackEvent(sb, cfg, verifiedEvent, "reconcile");
          if (outcome.status === "processed" && outcome.workspaceId) {
            await sendBillingEmailForEvent(sb, verifiedEvent, outcome).catch((e) =>
              console.error("billing reconcile email failed", e instanceof Error ? e.message : "error")
            );
          }
          summary.verified++;
        } else if (now.getTime() - Date.parse(txn.created_at) > abandonHours * 3_600_000) {
          await sb.from("billing_transactions").update({ status: "abandoned", failure_reason: "Checkout not completed" }).eq("reference", txn.reference).eq("status", "initialized");
          if (txn.purchase_id) await sb.from("workspace_purchases").update({ status: "abandoned" }).eq("id", txn.purchase_id).eq("status", "pending");
          summary.abandoned++;
        }
      } catch (e) {
        summary.errors.push(`txn ${txn.reference}: ${e instanceof Error ? e.message : "error"}`);
      }
    }
  }

  if (summary.errors.length) console.error("billing-reconcile-tick errors", summary.errors.slice(0, 20));
  return reply({ ok: true, ...summary, errors: summary.errors.length });
});

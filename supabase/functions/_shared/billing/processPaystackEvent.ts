// Maps one verified Paystack webhook event onto the atomic billing SQL
// functions. Every money-moving path goes through billing_apply_* (row
// locked, idempotent by reference); this module never writes
// subscriptions/purchases directly except for refund bookkeeping.
//
// Trust model: the event has ALREADY passed signature verification before
// it reaches here. Even so, nothing in the payload's metadata is trusted
// to pick a workspace - charges are matched by our own reference or by the
// provider codes we stored ourselves.
import type { AnySupabaseClient } from "../contentAuth.ts";
import { disableSubscription, type PaystackConfig } from "./paystack.ts";

export type PaystackEvent = { event?: string; data?: Record<string, unknown> };
export type ProcessResult = { status: "processed" | "ignored" | "failed"; result: string; workspaceId?: string | null };
export type Via = "webhook" | "verify_api" | "reconcile";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

async function rpc(sb: AnySupabaseClient, fn: string, args: Record<string, unknown>): Promise<string> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return String(data);
}

async function workspaceForReference(sb: AnySupabaseClient, reference: string): Promise<string | null> {
  const { data } = await sb.from("billing_transactions").select("workspace_id").eq("reference", reference).maybeSingle();
  return data?.workspace_id ?? null;
}

async function subscriptionByCode(sb: AnySupabaseClient, code: string) {
  const { data } = await sb
    .from("workspace_subscriptions")
    .select("id, workspace_id, status, current_period_end")
    .eq("provider_subscription_code", code)
    .maybeSingle();
  return data as { id: string; workspace_id: string; status: string; current_period_end: string | null } | null;
}

/**
 * After a plan change the replaced subscription is expired in our DB; stop
 * Paystack from charging it again. Best effort - a failure is reported,
 * not thrown, because the customer's new subscription is already live.
 */
async function disableReplacedAtProvider(sb: AnySupabaseClient, cfg: PaystackConfig, workspaceId: string): Promise<string> {
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data } = await sb
    .from("workspace_subscriptions")
    .select("provider_subscription_code, provider_email_token")
    .eq("workspace_id", workspaceId)
    .eq("status", "expired")
    .gte("cancelled_at", since)
    .not("provider_subscription_code", "is", null);
  const failures: string[] = [];
  for (const row of (data ?? []) as { provider_subscription_code: string; provider_email_token: string | null }[]) {
    if (!row.provider_email_token) {
      failures.push(`${row.provider_subscription_code}: no email token`);
      continue;
    }
    try {
      await disableSubscription(cfg, row.provider_subscription_code, row.provider_email_token);
    } catch (e) {
      failures.push(`${row.provider_subscription_code}: ${e instanceof Error ? e.message : "error"}`);
    }
  }
  return failures.length ? `; replaced-subscription disable failed: ${failures.join(", ")}` : "";
}

export async function processPaystackEvent(sb: AnySupabaseClient, cfg: PaystackConfig, event: PaystackEvent, via: Via): Promise<ProcessResult> {
  const type = event.event ?? "";
  const data = obj(event.data);

  switch (type) {
    case "charge.success": {
      const reference = str(data.reference);
      const amount = num(data.amount);
      const currency = str(data.currency);
      if (!reference || amount === null || !currency) return { status: "failed", result: "charge.success missing reference/amount/currency" };
      const paidAt = str(data.paid_at) ?? str(data.paidAt);

      const applied = await rpc(sb, "billing_apply_charge_success", {
        p_reference: reference, p_amount_minor: amount, p_currency: currency, p_paid_at: paidAt, p_via: via,
      });
      if (applied !== "unknown_reference") {
        const workspaceId = await workspaceForReference(sb, reference);
        let note = "";
        if (applied === "applied_replaced" && workspaceId) note = await disableReplacedAtProvider(sb, cfg, workspaceId);
        return { status: applied === "duplicate" ? "ignored" : "processed", result: applied + note, workspaceId };
      }

      // Not our reference: a Paystack-initiated renewal. Match via the
      // customer + plan codes we stored.
      const customerCode = str(obj(data.customer).customer_code);
      const planCode = str(obj(data.plan).plan_code);
      if (!customerCode || !planCode) return { status: "ignored", result: "unknown_reference" };
      // A customer code can span several workspaces (one Paystack customer
      // per email), so match the linked subscription itself.
      const { data: subs } = await sb
        .from("workspace_subscriptions")
        .select("workspace_id, provider_subscription_code, billing_prices!inner(paystack_plan_code)")
        .eq("provider_customer_code", customerCode)
        .eq("billing_prices.paystack_plan_code", planCode)
        .not("provider_subscription_code", "is", null)
        .in("status", ["active", "past_due", "grace", "cancelled"])
        .order("created_at", { ascending: false })
        .limit(1);
      const match = subs?.[0] as { workspace_id?: string; provider_subscription_code?: string } | undefined;
      const code = match?.provider_subscription_code;
      if (!code) return { status: "ignored", result: "renewal_without_linked_subscription" };
      const r = await rpc(sb, "billing_apply_renewal", {
        p_subscription_code: code, p_reference: reference, p_amount_minor: amount, p_currency: currency,
        p_paid_at: paidAt, p_next_payment_at: null, p_via: via,
      });
      return { status: r === "duplicate" ? "ignored" : "processed", result: `renewal:${r}`, workspaceId: match!.workspace_id ?? null };
    }

    case "subscription.create": {
      const code = str(data.subscription_code);
      const customerCode = str(obj(data.customer).customer_code);
      const planCode = str(obj(data.plan).plan_code);
      if (!code || !customerCode || !planCode) return { status: "failed", result: "subscription.create missing codes" };
      const r = await rpc(sb, "billing_link_provider_subscription", {
        p_customer_code: customerCode, p_plan_code: planCode, p_subscription_code: code,
        p_email_token: str(data.email_token), p_next_payment_at: str(data.next_payment_date),
      });
      const sub = await subscriptionByCode(sb, code);
      return { status: r === "linked" || r === "already_linked" ? "processed" : "ignored", result: r, workspaceId: sub?.workspace_id ?? null };
    }

    case "invoice.update":
    case "invoice.payment_succeeded": {
      const subscription = obj(data.subscription);
      const transaction = obj(data.transaction);
      const code = str(subscription.subscription_code);
      const reference = str(transaction.reference);
      const paid = data.paid === true || str(data.status) === "success";
      if (!paid || !code || !reference) return { status: "ignored", result: "invoice not paid or missing references" };
      const amount = num(data.amount) ?? num(transaction.amount);
      const currency = str(transaction.currency) ?? str(data.currency) ?? "ZAR";
      if (amount === null) return { status: "failed", result: "invoice missing amount" };
      // The first payment is ALSO delivered as charge.success with our
      // reference; that path owns it. Only treat this as a renewal when
      // the reference is not one of ours.
      if (await workspaceForReference(sb, reference)) return { status: "ignored", result: "initial payment handled by charge.success" };
      const r = await rpc(sb, "billing_apply_renewal", {
        p_subscription_code: code, p_reference: reference, p_amount_minor: amount, p_currency: currency,
        p_paid_at: str(data.paid_at), p_next_payment_at: str(subscription.next_payment_date), p_via: via,
      });
      const sub = await subscriptionByCode(sb, code);
      return { status: r === "duplicate" ? "ignored" : "processed", result: `renewal:${r}`, workspaceId: sub?.workspace_id ?? null };
    }

    case "invoice.payment_failed": {
      const code = str(obj(data.subscription).subscription_code);
      if (!code) return { status: "ignored", result: "no subscription code" };
      const sub = await subscriptionByCode(sb, code);
      if (!sub) return { status: "ignored", result: "unknown_subscription" };
      if (sub.status !== "active") return { status: "ignored", result: `already ${sub.status}`, workspaceId: sub.workspace_id };
      const ok = await rpc(sb, "billing_transition_subscription", {
        p_subscription_id: sub.id, p_expected_from: "active", p_to: "past_due", p_reason: "Renewal payment failed", p_actor: via === "webhook" ? "webhook" : "reconcile",
      });
      return { status: "processed", result: ok === "true" ? "past_due" : "no_change", workspaceId: sub.workspace_id };
    }

    case "subscription.not_renew":
    case "subscription.disable": {
      const code = str(data.subscription_code);
      if (!code) return { status: "ignored", result: "no subscription code" };
      const sub = await subscriptionByCode(sb, code);
      if (!sub) return { status: "ignored", result: "unknown_subscription" };
      if (!["active", "past_due", "grace", "cancelled"].includes(sub.status)) return { status: "ignored", result: `already ${sub.status}`, workspaceId: sub.workspace_id };
      const periodEnded = !sub.current_period_end || Date.parse(sub.current_period_end) <= Date.now();
      const to = type === "subscription.disable" && periodEnded ? "expired" : "cancelled";
      if (sub.status === to) return { status: "ignored", result: `already ${to}`, workspaceId: sub.workspace_id };
      if (sub.status === "cancelled" && to !== "expired") return { status: "ignored", result: "already cancelled", workspaceId: sub.workspace_id };
      const ok = await rpc(sb, "billing_transition_subscription", {
        p_subscription_id: sub.id, p_expected_from: sub.status, p_to: to,
        p_reason: type === "subscription.not_renew" ? "Set to not renew at Paystack" : "Disabled at Paystack", p_actor: via === "webhook" ? "webhook" : "reconcile",
      });
      return { status: "processed", result: ok === "true" ? to : "no_change", workspaceId: sub.workspace_id };
    }

    case "refund.processed": {
      const reference = str(data.transaction_reference) ?? str(obj(data.transaction).reference);
      if (!reference) return { status: "ignored", result: "refund without reference" };
      const { data: txn } = await sb.from("billing_transactions").select("id, workspace_id, purchase_id, status").eq("reference", reference).maybeSingle();
      if (!txn) return { status: "ignored", result: "unknown_reference" };
      if (txn.status === "reversed") return { status: "ignored", result: "already reversed", workspaceId: txn.workspace_id };
      await sb.from("billing_transactions").update({ status: "reversed", failure_reason: "Refunded" }).eq("id", txn.id);
      if (txn.purchase_id) await sb.from("workspace_purchases").update({ status: "refunded" }).eq("id", txn.purchase_id);
      return { status: "processed", result: "reversed", workspaceId: txn.workspace_id };
    }

    default:
      return { status: "ignored", result: `unhandled event ${type || "(none)"}` };
  }
}

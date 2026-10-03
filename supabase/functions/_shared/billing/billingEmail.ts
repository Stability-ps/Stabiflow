import type { AnySupabaseClient } from "../contentAuth.ts";
import type { PaystackEvent, ProcessResult } from "./processPaystackEvent.ts";

type TemplateKey = "payment_success" | "renewal_success" | "payment_failed" | "subscription_cancelled" | "refund_processed";
type MailSpec = {
  eventKey: string;
  template: TemplateKey;
  subject: string;
  preheader: string;
  heading: string;
  intro: string;
  planName?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
  reference?: string | null;
  paidAt?: string | null;
  nextPaymentAt?: string | null;
  ctaLabel?: string;
};

const APP_URL = (Deno.env.get("APP_BASE_URL") || "https://app.stabiflow.com").replace(/\/$/, "");
const PUBLIC_URL = (Deno.env.get("PUBLIC_SITE_URL") || "https://stabiflow.com").replace(/\/$/, "");
const LOGO_URL = `${PUBLIC_URL}/brand/StabiFlow_Full_Logo_Light.png`;
const SUPPORT_EMAIL = "support@stabiflow.com";

const str = (v: unknown): string | null => typeof v === "string" && v.trim() ? v.trim() : null;
const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && Number.isFinite(Number(v)) ? Number(v) : null;
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]!));

function money(minor?: number | null, currency = "ZAR") {
  if (minor == null) return null;
  try { return new Intl.NumberFormat("en-ZA", { style: "currency", currency }).format(minor / 100); }
  catch { return `${currency} ${(minor / 100).toFixed(2)}`; }
}

function date(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
}

async function planForReference(sb: AnySupabaseClient, reference: string) {
  const { data } = await sb.from("billing_transactions")
    .select("kind, amount_minor, currency, paid_at, price_id, purchase_id, subscription_id, billing_prices(billing_interval, billing_plans(name, code))")
    .eq("reference", reference).maybeSingle();
  const price = obj(data?.billing_prices);
  const plan = obj(price.billing_plans);
  return {
    name: str(plan.name),
    code: str(plan.code),
    interval: str(price.billing_interval),
    amount: num(data?.amount_minor),
    currency: str(data?.currency),
    paidAt: str(data?.paid_at),
    kind: str(data?.kind),
  };
}

async function planForSubscription(sb: AnySupabaseClient, subscriptionCode: string) {
  const { data } = await sb.from("workspace_subscriptions")
    .select("current_period_end, billing_prices(amount_minor, currency, billing_interval, billing_plans(name, code))")
    .eq("provider_subscription_code", subscriptionCode).maybeSingle();
  const price = obj(data?.billing_prices);
  const plan = obj(price.billing_plans);
  return {
    name: str(plan.name),
    code: str(plan.code),
    interval: str(price.billing_interval),
    amount: num(price.amount_minor),
    currency: str(price.currency),
    next: str(data?.current_period_end),
  };
}

function render(spec: MailSpec) {
  const rows: string[] = [];
  if (spec.planName) rows.push(`<tr><td style="padding:9px 0;color:#64748b">Plan</td><td style="padding:9px 0;text-align:right;font-weight:700;color:#0f172a">${esc(spec.planName)}</td></tr>`);
  const formattedAmount = money(spec.amountMinor, spec.currency || "ZAR");
  if (formattedAmount) rows.push(`<tr><td style="padding:9px 0;color:#64748b">Amount</td><td style="padding:9px 0;text-align:right;font-weight:700;color:#0f172a">${esc(formattedAmount)}</td></tr>`);
  if (spec.reference) rows.push(`<tr><td style="padding:9px 0;color:#64748b">Reference</td><td style="padding:9px 0;text-align:right;font-size:12px;color:#0f172a">${esc(spec.reference)}</td></tr>`);
  const paid = date(spec.paidAt);
  if (paid) rows.push(`<tr><td style="padding:9px 0;color:#64748b">Date</td><td style="padding:9px 0;text-align:right;color:#0f172a">${esc(paid)}</td></tr>`);
  const next = date(spec.nextPaymentAt);
  if (next) rows.push(`<tr><td style="padding:9px 0;color:#64748b">Next renewal</td><td style="padding:9px 0;text-align:right;color:#0f172a">${esc(next)}</td></tr>`);

  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Inter,Arial,sans-serif;color:#0f172a">
  <div style="display:none;max-height:0;overflow:hidden">${esc(spec.preheader)}</div>
  <table width="100%" role="presentation" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:32px 12px"><tr><td align="center">
    <table width="100%" role="presentation" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden">
      <tr><td style="padding:28px 32px 18px"><img src="${LOGO_URL}" alt="StabiFlow" width="150" style="display:block;max-width:150px;height:auto"></td></tr>
      <tr><td style="padding:0 32px"><div style="height:5px;border-radius:999px;background:linear-gradient(90deg,#06b6d4,#0ea5e9,#7c3aed)"></div></td></tr>
      <tr><td style="padding:30px 32px 12px">
        <div style="display:inline-block;background:#ecfdf5;color:#047857;font-size:12px;font-weight:700;padding:7px 10px;border-radius:999px">PAYMENT UPDATE</div>
        <h1 style="font-size:28px;line-height:1.2;margin:16px 0 10px;color:#0f172a">${esc(spec.heading)}</h1>
        <p style="font-size:15px;line-height:1.65;color:#475569;margin:0">${esc(spec.intro)}</p>
      </td></tr>
      <tr><td style="padding:14px 32px"><table width="100%" role="presentation" cellspacing="0" style="border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0">${rows.join("")}</table></td></tr>
      <tr><td style="padding:14px 32px 32px">
        <a href="${APP_URL}/app/billing" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:10px">${esc(spec.ctaLabel || "Open StabiFlow")}</a>
        <p style="font-size:13px;line-height:1.6;color:#64748b;margin:24px 0 0">Need help? Email <a href="mailto:${SUPPORT_EMAIL}" style="color:#0284c7">${SUPPORT_EMAIL}</a>.</p>
      </td></tr>
      <tr><td style="padding:20px 32px;background:#f8fafc;font-size:12px;line-height:1.6;color:#64748b">StabiFlow · Create. Advertise. Connect. Convert.<br>This StabiFlow confirmation is provided alongside your payment processor receipt.</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

async function send(sb: AnySupabaseClient, workspaceId: string, spec: MailSpec) {
  const apiKey = Deno.env.get("RESEND_API_KEY")?.trim();
  if (!apiKey) {
    console.warn("billing email skipped: RESEND_API_KEY is not configured");
    return;
  }
  const { data: customer } = await sb.from("billing_customers").select("email").eq("workspace_id", workspaceId).maybeSingle();
  const to = str(customer?.email);
  if (!to) return;

  const { data: claim, error: claimError } = await sb.from("billing_email_deliveries").insert({
    event_key: spec.eventKey, workspace_id: workspaceId, recipient_email: to, template_key: spec.template, status: "sending",
  }).select("id").maybeSingle();
  if (claimError) {
    if ((claimError as { code?: string }).code === "23505") return;
    console.error("billing email delivery claim failed", claimError.message);
    return;
  }

  const from = Deno.env.get("BILLING_EMAIL_FROM")?.trim() || "StabiFlow <billing@stabiflow.com>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], reply_to: SUPPORT_EMAIL, subject: spec.subject, html: render(spec) }),
    });
    const body = await res.json().catch(() => ({})) as { id?: string; message?: string };
    if (!res.ok) throw new Error(body.message || `Resend HTTP ${res.status}`);
    await sb.from("billing_email_deliveries").update({
      status: "sent", provider_message_id: body.id ?? null, sent_at: new Date().toISOString(),
    }).eq("id", claim!.id);
  } catch (e) {
    // Do not make a verified payment fail because an email provider is down.
    // Remove the sending claim so a later verified redelivery/reconcile may retry.
    await sb.from("billing_email_deliveries").delete().eq("id", claim!.id).eq("status", "sending");
    console.error("billing email send failed", e instanceof Error ? e.message : "error");
  }
}

export async function sendBillingEmailForEvent(
  sb: AnySupabaseClient,
  event: PaystackEvent,
  outcome: ProcessResult,
): Promise<void> {
  if (outcome.status !== "processed" || !outcome.workspaceId) return;
  const type = event.event ?? "";
  const data = obj(event.data);

  if (type === "charge.success") {
    const reference = str(data.reference);
    if (!reference) return;
    const plan = await planForReference(sb, reference);
    const isRenewal = outcome.result.startsWith("renewal:");
    const amount = num(data.amount) ?? plan.amount;
    const currency = str(data.currency) ?? plan.currency ?? "ZAR";
    const paidAt = str(data.paid_at) ?? str(data.paidAt) ?? plan.paidAt;
    await send(sb, outcome.workspaceId, {
      eventKey: `${isRenewal ? "renewal" : "charge"}:${reference}`,
      template: isRenewal ? "renewal_success" : "payment_success",
      subject: isRenewal ? `StabiFlow ${plan.name || "subscription"} renewed` : `Payment confirmed — ${plan.name || "StabiFlow"}`,
      preheader: isRenewal ? "Your StabiFlow subscription renewal was successful." : "Your StabiFlow payment was successful.",
      heading: isRenewal ? "Subscription renewed ✓" : plan.kind === "one_off" ? "Purchase confirmed ✓" : "Plan activated ✓",
      intro: isRenewal ? "Your recurring payment was successful and your StabiFlow access continues." : "Thank you. Your payment has been confirmed and your StabiFlow access has been updated.",
      planName: plan.name, amountMinor: amount, currency, reference, paidAt, ctaLabel: "Open billing",
    });
    return;
  }

  if (type === "invoice.payment_succeeded" || type === "invoice.update") {
    if (!outcome.result.startsWith("renewal:")) return;
    const transaction = obj(data.transaction);
    const subscription = obj(data.subscription);
    const reference = str(transaction.reference);
    const code = str(subscription.subscription_code);
    if (!reference || !code) return;
    const plan = await planForSubscription(sb, code);
    await send(sb, outcome.workspaceId, {
      eventKey: `renewal:${reference}`, template: "renewal_success",
      subject: `StabiFlow ${plan.name || "subscription"} renewed`,
      preheader: "Your StabiFlow subscription renewal was successful.", heading: "Subscription renewed ✓",
      intro: "Your recurring payment was successful and your StabiFlow access continues.",
      planName: plan.name, amountMinor: num(data.amount) ?? num(transaction.amount) ?? plan.amount,
      currency: str(transaction.currency) ?? str(data.currency) ?? plan.currency ?? "ZAR",
      reference, paidAt: str(data.paid_at), nextPaymentAt: str(subscription.next_payment_date) ?? plan.next,
      ctaLabel: "Manage subscription",
    });
    return;
  }

  if (type === "invoice.payment_failed") {
    const code = str(obj(data.subscription).subscription_code);
    if (!code) return;
    const plan = await planForSubscription(sb, code);
    await send(sb, outcome.workspaceId, {
      eventKey: `failed:${code}:${str(data.invoice_code) || str(data.due_date) || "current"}`,
      template: "payment_failed", subject: "Action needed — StabiFlow payment failed",
      preheader: "We could not process your StabiFlow subscription payment.", heading: "Payment needs attention",
      intro: "We could not confirm your subscription renewal. Please review your billing details to avoid an interruption in access.",
      planName: plan.name, amountMinor: num(data.amount) ?? plan.amount, currency: str(data.currency) ?? plan.currency ?? "ZAR",
      nextPaymentAt: plan.next, ctaLabel: "Review billing",
    });
    return;
  }

  if (type === "subscription.not_renew" || type === "subscription.disable") {
    const code = str(data.subscription_code);
    if (!code) return;
    const plan = await planForSubscription(sb, code);
    await send(sb, outcome.workspaceId, {
      eventKey: `cancel:${code}:${type}`, template: "subscription_cancelled",
      subject: "StabiFlow subscription update", preheader: "Your StabiFlow subscription renewal has been stopped.",
      heading: "Subscription cancelled", intro: plan.next ? "Your subscription will not renew. You can continue using paid features until the end of your current billing period." : "Your subscription has been cancelled.",
      planName: plan.name, nextPaymentAt: plan.next, ctaLabel: "View billing",
    });
    return;
  }

  if (type === "refund.processed") {
    const reference = str(data.transaction_reference) ?? str(obj(data.transaction).reference);
    if (!reference) return;
    const plan = await planForReference(sb, reference);
    await send(sb, outcome.workspaceId, {
      eventKey: `refund:${reference}`, template: "refund_processed", subject: "StabiFlow refund processed",
      preheader: "Your StabiFlow refund has been processed.", heading: "Refund processed",
      intro: "Your refund has been recorded. Your bank or card provider may take additional time to display the funds.",
      planName: plan.name, amountMinor: num(data.amount) ?? plan.amount, currency: str(data.currency) ?? plan.currency ?? "ZAR",
      reference, ctaLabel: "View billing",
    });
  }
}

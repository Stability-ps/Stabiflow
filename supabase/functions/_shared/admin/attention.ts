// Needs Attention: turns admin_attention_signals() facts into ranked, actionable
// alerts. Every alert comes from a real row or count - nothing here invents a
// condition. Pure module (shared by the edge function and unit tests).

export type Severity = "critical" | "high" | "medium" | "low";
export type AttentionArea = "billing" | "automations" | "publishing" | "integrations" | "messaging" | "ai" | "creative" | "business_studio" | "usage";

export type Alert = {
  id: string;
  severity: Severity;
  area: AttentionArea;
  title: string;
  detail: string;
  at: string | null;
  workspace: { id: string; name: string | null } | null;
  /** Admin route that resolves or explains the alert. */
  href: string;
};

type Ws = { workspace_id: string | null; workspace_name: string | null };
type At = { at: string | null };
export type AttentionSignals = {
  failed_webhooks: (Ws & At & { id: string; provider: string; event_type: string; processing_result: string | null })[];
  payment_problems: (Ws & At & { id: string; reference: string; status: string; failure_reason: string | null; amount_minor: number; currency: string })[];
  subscriptions_at_risk: (Ws & At & { id: string; status: string; grace_until: string | null; current_period_end: string | null; cancel_at_period_end: boolean; plan_name: string | null })[];
  automation_failures: (Ws & At & { automation_id: string; automation_name: string; failures: number })[];
  publishing_failures: (Ws & At & { failures: number })[];
  integration_problems: (Ws & At & { id: string; provider: string; status: string; last_health_check_status: string | null; token_expires_at: string | null; webhook_subscription_status: string | null })[];
  message_dead_letters: (Ws & At & { failures: number })[];
  ai_24h: { calls: number; failed: number; at: string | null };
  creative_failures: (Ws & At & { failures: number })[];
  website_scan_failures: { failed: number; total: number; at: string | null };
  near_limits: (Ws & At & { entitlement_key: string; used: number; limit_value: number })[];
  stale_checkouts: number;
};

const RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function ws(row: Ws) {
  return row.workspace_id ? { id: row.workspace_id, name: row.workspace_name } : null;
}

function bizHref(row: Ws, fallback: string) {
  return row.workspace_id ? `/admin/businesses/${row.workspace_id}` : fallback;
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function money(minor: number, currency: string) {
  return `${currency} ${(Number(minor) / 100).toFixed(2)}`;
}

export const AI_FAILURE_MIN_CALLS = 20;
export const AI_FAILURE_RATE = 0.1;

export function buildAlerts(s: AttentionSignals, now: Date = new Date()): Alert[] {
  const out: Alert[] = [];

  for (const w of s.failed_webhooks) {
    out.push({
      id: `webhook:${w.id}`, severity: "critical", area: "billing",
      title: `Payment webhook failed: ${w.event_type}`,
      detail: w.processing_result ? `Processing result: ${w.processing_result}` : "The event was received but could not be processed. Entitlements may be out of sync with Paystack.",
      at: w.at, workspace: ws(w), href: "/admin/transactions?view=webhooks",
    });
  }

  for (const t of s.payment_problems) {
    const mismatch = t.status === "amount_mismatch";
    out.push({
      id: `txn:${t.id}`, severity: mismatch ? "critical" : t.status === "reversed" ? "high" : "medium", area: "billing",
      title: mismatch ? `Paid amount does not match price (${t.reference})` : t.status === "reversed" ? `Payment reversed (${t.reference})` : `Payment failed (${t.reference})`,
      detail: [money(t.amount_minor, t.currency), t.failure_reason].filter(Boolean).join(" · "),
      at: t.at, workspace: ws(t), href: `/admin/transactions?q=${encodeURIComponent(t.reference)}`,
    });
  }

  for (const sub of s.subscriptions_at_risk) {
    const ending = sub.status === "active" && sub.cancel_at_period_end;
    out.push({
      id: `sub:${sub.id}`, severity: sub.status === "grace" ? "high" : ending ? "low" : "high", area: "billing",
      title: ending ? `Subscription ends soon: ${sub.plan_name ?? "plan"}` : `Subscription ${sub.status.replace("_", " ")}: ${sub.plan_name ?? "plan"}`,
      detail: ending
        ? `Cancels at period end${sub.current_period_end ? ` (${sub.current_period_end.slice(0, 10)})` : ""}.`
        : sub.grace_until ? `Access continues until ${sub.grace_until.slice(0, 10)}.` : "Renewal payment has not succeeded.",
      at: sub.at, workspace: ws(sub), href: bizHref(sub, "/admin/subscriptions"),
    });
  }

  for (const a of s.automation_failures) {
    out.push({
      id: `automation:${a.automation_id}`, severity: a.failures >= 5 ? "high" : "medium", area: "automations",
      title: `Automation failing: ${a.automation_name}`,
      detail: `${plural(a.failures, "failed run")} in the last 7 days.`,
      at: a.at, workspace: ws(a), href: bizHref(a, "/admin/health"),
    });
  }

  for (const p of s.publishing_failures) {
    out.push({
      id: `publishing:${p.workspace_id}`, severity: p.failures >= 3 ? "high" : "medium", area: "publishing",
      title: "Scheduled posts failed to publish",
      detail: `${plural(p.failures, "post")} failed in the last 7 days.`,
      at: p.at, workspace: ws(p), href: bizHref(p, "/admin/health"),
    });
  }

  for (const i of s.integration_problems) {
    const provider = i.provider === "meta" ? "Meta" : i.provider === "whatsapp" ? "WhatsApp" : i.provider;
    const expiring = i.token_expires_at && new Date(i.token_expires_at).getTime() < now.getTime() + 7 * 86_400_000;
    const expired = i.token_expires_at && new Date(i.token_expires_at).getTime() <= now.getTime();
    out.push({
      id: `integration:${i.id}`, severity: i.status === "error" || expired ? "high" : "medium", area: "integrations",
      title: i.status === "error" ? `${provider} connection in error` : expired ? `${provider} access token expired` : expiring ? `${provider} access token expires soon` : `${provider} health check failing`,
      detail: [i.last_health_check_status && `Health: ${i.last_health_check_status}`, i.webhook_subscription_status && `Webhook: ${i.webhook_subscription_status}`, i.token_expires_at && `Token expiry: ${i.token_expires_at.slice(0, 10)}`].filter(Boolean).join(" · ") || "Reconnect required.",
      at: i.at, workspace: ws(i), href: bizHref(i, "/admin/health"),
    });
  }

  for (const m of s.message_dead_letters) {
    out.push({
      id: `deadletter:${m.workspace_id}`, severity: "high", area: "messaging",
      title: "WhatsApp messages could not be delivered",
      detail: `${plural(m.failures, "message")} dead-lettered after retries in the last 7 days.`,
      at: m.at, workspace: ws(m), href: bizHref(m, "/admin/health"),
    });
  }

  if (s.ai_24h.calls >= AI_FAILURE_MIN_CALLS && s.ai_24h.failed / s.ai_24h.calls >= AI_FAILURE_RATE) {
    const pct = Math.round((s.ai_24h.failed / s.ai_24h.calls) * 100);
    out.push({
      id: "ai:failure-rate", severity: pct >= 30 ? "critical" : "high", area: "ai",
      title: `AI failure rate ${pct}% in the last 24 hours`,
      detail: `${s.ai_24h.failed} of ${s.ai_24h.calls} AI requests failed.`,
      at: s.ai_24h.at, workspace: null, href: "/admin/usage",
    });
  }

  for (const c of s.creative_failures) {
    out.push({
      id: `creative:${c.workspace_id}`, severity: c.failures >= 5 ? "medium" : "low", area: "creative",
      title: "Creative Studio visuals failed",
      detail: `${plural(c.failures, "visual")} failed to generate in the last 7 days.`,
      at: c.at, workspace: ws(c), href: bizHref(c, "/admin/usage"),
    });
  }

  const scans = s.website_scan_failures;
  if (scans.failed >= 3 && scans.failed / Math.max(scans.total, 1) >= 0.25) {
    out.push({
      id: "business-studio:scan-failures", severity: "medium", area: "business_studio",
      title: "Website scans are failing",
      detail: `${scans.failed} of ${scans.total} Business Studio website scans failed in the last 7 days.`,
      at: scans.at, workspace: null, href: "/admin/business-studio",
    });
  }

  for (const u of s.near_limits) {
    const pct = Math.round((u.used / u.limit_value) * 100);
    out.push({
      id: `limit:${u.workspace_id}:${u.entitlement_key}`, severity: pct >= 100 ? "medium" : "low", area: "usage",
      title: `${pct >= 100 ? "Reached" : "Nearing"} ${u.entitlement_key.replace(/_/g, " ")} allowance`,
      detail: `${u.used} of ${u.limit_value} used this month (${pct}%). A likely upgrade conversation.`,
      at: u.at, workspace: ws(u), href: bizHref(u, "/admin/usage"),
    });
  }

  if (s.stale_checkouts >= 3) {
    out.push({
      id: "billing:stale-checkouts", severity: "low", area: "billing",
      title: "Checkouts started but not completed",
      detail: `${s.stale_checkouts} checkouts in the last 7 days were opened but never paid.`,
      at: null, workspace: null, href: "/admin/transactions?status=initialized",
    });
  }

  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity] || (b.at ?? "").localeCompare(a.at ?? ""));
}

// Owner dashboard: "what is happening in StabiFlow right now?" Every number
// comes from admin_overview(); none is estimated client-side.
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActivityFeed } from "@/components/admin/ActivityFeed";
import { AdminPageHeader, ErrorState, LoadingRows, LoadingTiles, Section, StatGrid, StatTile } from "@/components/admin/AdminPrimitives";
import { AttentionList } from "@/components/admin/AttentionList";
import { ColumnChart } from "@/components/admin/ColumnChart";
import { DateRangeControl } from "@/components/admin/DateRangeControl";
import { useAdminRange } from "@/hooks/useAdminRange";
import { useAdmin } from "@/hooks/useAdmin";
import { adminConsole, type ActivityRow, type AdminAlert, type AdminOverview as Overview } from "@/lib/adminApi";
import { rangeParams } from "@/lib/adminDateRange";
import { formatCount, formatDate, formatMoney, formatPercent, formatUsd } from "@/lib/adminFormat";
import { useSearchParams } from "react-router-dom";

function MoneyList({ rows, empty }: { rows: { currency: string; minor: number }[]; empty: string }) {
  if (rows.length === 0) return <span className="text-base font-medium text-muted-foreground">{empty}</span>;
  return (
    <span className="flex flex-col">
      {rows.map((r) => <span key={r.currency}>{formatMoney(r.minor, r.currency, { compact: true })}</span>)}
    </span>
  );
}

export default function AdminOverview() {
  const range = useAdminRange();
  const [params] = useSearchParams();
  const { can } = useAdmin();
  const carry = rangeParams(params);

  const overview = useQuery({
    queryKey: ["admin-overview", range.fromIso, range.toIso],
    queryFn: () => adminConsole<{ data: Overview }>("overview", { from: range.fromIso, to: range.toIso }).then((r) => r.data),
  });
  const attention = useQuery({ queryKey: ["admin-attention"], queryFn: () => adminConsole<{ alerts: AdminAlert[] }>("attention").then((r) => r.alerts), refetchInterval: 120_000 });
  const activity = useQuery({ queryKey: ["admin-activity", 12], queryFn: () => adminConsole<{ rows: ActivityRow[] }>("activity", { limit: 12 }).then((r) => r.rows), refetchInterval: 60_000 });

  const o = overview.data;
  const p = o?.product;
  const rangeLabel = range.label.toLowerCase();

  return (
    <>
      <AdminPageHeader
        title="Owner dashboard"
        description="Customers, product usage, revenue and platform health from live StabiFlow data."
        actions={<DateRangeControl />}
      />

      <Section
        title={`Needs attention${attention.data ? ` · ${attention.data.length}` : ""}`}
        description="Real problems detected right now. Each links to where it can be resolved."
        actions={<Button asChild variant="ghost" size="sm"><Link to="/admin/attention">View all <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link></Button>}
      >
        {attention.isLoading ? <LoadingRows rows={3} /> : attention.error ? <ErrorState error={attention.error} onRetry={() => void attention.refetch()} /> : <AttentionList alerts={attention.data ?? []} limit={5} />}
      </Section>

      {overview.isLoading ? <LoadingTiles count={12} /> : overview.error || !o || !p ? <ErrorState error={overview.error} onRetry={() => void overview.refetch()} /> : (
        <>
          <section aria-labelledby="kpi-customers" className="space-y-3">
            <h2 id="kpi-customers" className="text-sm font-semibold text-muted-foreground">Customers</h2>
            <StatGrid>
              <StatTile label="Registered users" value={formatCount(o.users.total)} sub={`+${o.users.new_today} today · +${o.users.new_7d} in 7 days`} href={can("users.read") ? "/admin/users" : undefined} />
              <StatTile label="Businesses" value={formatCount(o.workspaces.total)} sub={`+${o.workspaces.new_in_range} ${rangeLabel}`} href={can("businesses.read") ? "/admin/businesses" : undefined} />
              <StatTile
                label="Active businesses" value={formatCount(o.workspaces.active_in_range)} sub={`${formatPercent(o.workspaces.active_in_range, o.workspaces.total)} of businesses · ${rangeLabel}`}
                help="Businesses with at least one recorded action in the range: an activity-log entry, an AI request, an outbound WhatsApp message or a new lead."
              />
              <StatTile label="Paying businesses" value={formatCount(o.workspaces.paying)} sub={`${formatPercent(o.workspaces.paying, o.workspaces.total)} of businesses`} help="A live subscription (active, past due or in grace) or an unexpired paid one-off purchase." href={can("billing.read") ? "/admin/subscriptions" : undefined} />
              <StatTile label="Users signed in · 7 days" value={formatCount(o.users.signed_in_7d)} sub={`${o.users.signed_in_1d} in 24h · ${o.users.signed_in_30d} in 30 days`} help="Based on each account's most recent sign-in. Returning visitors whose session was still valid are not counted, so this understates true active users." />
              <StatTile label="New users" value={formatCount(o.users.new_in_range)} sub={rangeLabel} />
              <StatTile label="Users without a business" value={formatCount(o.users.without_workspace)} sub="Signed up but never created or joined one" tone={o.users.without_workspace > 0 ? "warning" : "default"} href={can("users.read") ? "/admin/users?filter=no_workspace" : undefined} />
              <StatTile label="Unconfirmed emails" value={formatCount(o.users.unconfirmed)} sub="Never confirmed their address" href={can("users.read") ? "/admin/users?filter=unconfirmed" : undefined} />
            </StatGrid>
          </section>

          {can("billing.read") ? (
            <section aria-labelledby="kpi-revenue" className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 id="kpi-revenue" className="text-sm font-semibold text-muted-foreground">Revenue</h2>
                <Link to={`/admin/revenue${carry}`} className="text-xs text-muted-foreground hover:text-foreground">Revenue detail →</Link>
              </div>
              {!o.tracking_since.billing ? (
                <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Payment data not connected: no Paystack transaction has been recorded yet.</p>
              ) : (
                <StatGrid>
                  <StatTile label="Revenue" value={<MoneyList rows={o.revenue.by_currency.map((r) => ({ currency: r.currency, minor: r.gross_minor }))} empty="No payments" />} sub={`Gross, verified Paystack payments · ${rangeLabel}`} help="Sum of successful, verified transactions by the currency actually paid. Currencies are never added together." href={`/admin/transactions${carry}`} />
                  <StatTile label="MRR" value={<MoneyList rows={o.revenue.mrr_by_currency.map((r) => ({ currency: r.currency, minor: r.mrr_minor }))} empty="No active subscriptions" />} sub="Active subscriptions, monthly equivalent" help="Monthly price of every active subscription, with annual prices divided by 12. Past-due and grace subscriptions are excluded and shown separately as at-risk." />
                  <StatTile label="Active subscriptions" value={formatCount(o.subscriptions.active)} sub={`${o.subscriptions.started} started ${rangeLabel}`} href="/admin/subscriptions" />
                  <StatTile label="At-risk subscriptions" value={formatCount(o.subscriptions.at_risk)} sub="Past due or in grace" tone={o.subscriptions.at_risk > 0 ? "warning" : "default"} href="/admin/subscriptions?status=past_due" />
                  <StatTile label="Failed payments" value={formatCount(o.subscriptions.failed_payments)} sub={rangeLabel} tone={o.subscriptions.failed_payments > 0 ? "warning" : "default"} href="/admin/transactions?status=failed" />
                  <StatTile label="Cancellations" value={formatCount(o.subscriptions.cancelled)} sub={rangeLabel} />
                  <StatTile label="Reversed payments" value={formatCount(o.subscriptions.reversed_payments)} sub={rangeLabel} tone={o.subscriptions.reversed_payments > 0 ? "danger" : "default"} />
                </StatGrid>
              )}
            </section>
          ) : null}

          <section aria-labelledby="kpi-product" className="space-y-3">
            <h2 id="kpi-product" className="text-sm font-semibold text-muted-foreground">Product usage · {rangeLabel}</h2>
            <StatGrid>
              <StatTile label="Leads created" value={formatCount(p.leads_created)} sub={`${p.customers_created} customers · ${p.opportunities_won} deals won`} />
              <StatTile label="Automation runs" value={formatCount(p.automation_runs)} sub={p.automation_runs ? `${formatPercent(p.automation_runs_succeeded, p.automation_runs)} succeeded · ${p.automation_runs_failed} failed` : `${p.automations_active} active automations`} tone={p.automation_runs_failed > 0 ? "warning" : "default"} />
              <StatTile label="AI requests" value={formatCount(o.ai.calls)} sub={o.ai.calls ? `${formatPercent(o.ai.failed, o.ai.calls)} failed · ${formatCount(o.ai.tokens)} tokens` : "No AI usage"} href="/admin/usage" />
              <StatTile label="AI cost (estimated)" value={formatUsd(o.ai.cost_usd)} sub={o.ai.calls_without_cost ? `${o.ai.calls_without_cost} requests have no cost recorded` : "From recorded token usage"} help="Sum of the estimated cost each AI feature recorded from its model's token usage at the time of the request." />
              <StatTile label="WhatsApp messages" value={formatCount(p.messages_in + p.messages_out)} sub={`${formatCount(p.messages_in)} in · ${formatCount(p.messages_out)} out${p.messages_dead_lettered ? ` · ${p.messages_dead_lettered} undeliverable` : ""}`} tone={p.messages_dead_lettered > 0 ? "warning" : "default"} />
              <StatTile label="Posts published" value={formatCount(p.posts_published)} sub={p.posts_failed ? `${p.posts_failed} failed` : "No publishing failures"} tone={p.posts_failed > 0 ? "warning" : "default"} />
              <StatTile label="Creative Studio concepts" value={formatCount(p.creative_concepts)} sub={p.creative_failed ? `${p.creative_failed} visuals failed` : `${p.campaigns_created} ad campaigns created`} />
              <StatTile label="Business Studio scans" value={formatCount(p.website_scans)} sub={`${p.website_scans_failed} failed · ${p.profiles_published} profiles live`} href="/admin/business-studio" />
            </StatGrid>
          </section>

          <div className="grid items-start gap-4 xl:grid-cols-3">
            <div className="grid items-start gap-4 md:grid-cols-2 xl:col-span-2">
              <Section title="New users per day"><ColumnChart title="New users" points={o.series.map((s) => ({ date: s.date, value: s.signups }))} /></Section>
              <Section title="New businesses per day"><ColumnChart title="New businesses" points={o.series.map((s) => ({ date: s.date, value: s.workspaces }))} /></Section>
              <Section title="AI requests per day"><ColumnChart title="AI requests" points={o.series.map((s) => ({ date: s.date, value: s.ai_calls }))} /></Section>
              <Section title="Successful payments per day"><ColumnChart title="Successful payments" points={o.series.map((s) => ({ date: s.date, value: s.payments }))} /></Section>
            </div>
            <Section title="Live activity" actions={<Button asChild variant="ghost" size="sm"><Link to="/admin/activity">All</Link></Button>}>
              {activity.isLoading ? <LoadingRows rows={6} /> : activity.error ? <ErrorState error={activity.error} onRetry={() => void activity.refetch()} /> : <ActivityFeed rows={activity.data ?? []} />}
            </Section>
          </div>

          <p className="text-xs text-muted-foreground">
            Data history: accounts since {formatDate(o.tracking_since.users)}
            {o.tracking_since.activity_log ? ` · activity log since ${formatDate(o.tracking_since.activity_log)}` : ""}
            {o.tracking_since.ai_usage ? ` · AI usage since ${formatDate(o.tracking_since.ai_usage)}` : ""}
            {o.tracking_since.billing ? ` · payments since ${formatDate(o.tracking_since.billing)}` : ""}. Nothing before these dates is estimated.
          </p>
        </>
      )}
    </>
  );
}

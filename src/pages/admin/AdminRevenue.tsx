// Revenue from verified Paystack transactions only. Each currency is
// reported on its own; nothing is converted or summed across currencies.
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AdminPageHeader, DataTable, EmptyNote, ErrorState, LoadingTiles, RequirePermission, Section, StatGrid, StatTile, Td, Th } from "@/components/admin/AdminPrimitives";
import { ColumnChart } from "@/components/admin/ColumnChart";
import { DateRangeControl } from "@/components/admin/DateRangeControl";
import { useAdminRange } from "@/hooks/useAdminRange";
import { ExportButton } from "@/components/admin/ExportButton";
import { Button } from "@/components/ui/button";
import { adminConsole, type AdminRevenue as Revenue } from "@/lib/adminApi";
import { rangeParams } from "@/lib/adminDateRange";
import { formatCount, formatDate, formatMoney, humanize } from "@/lib/adminFormat";

function RevenueView() {
  const range = useAdminRange();
  const [params] = useSearchParams();
  const carry = rangeParams(params);
  const q = useQuery({
    queryKey: ["admin-revenue", range.fromIso, range.toIso],
    queryFn: () => adminConsole<{ data: Revenue }>("revenue", { from: range.fromIso, to: range.toIso }).then((r) => r.data),
  });
  const currencies = [...new Set([...(q.data?.by_currency ?? []).map((c) => c.currency), ...(q.data?.mrr ?? []).map((m) => m.currency)])].sort();
  const [picked, setPicked] = useState<string | null>(null);
  const currency = picked && currencies.includes(picked) ? picked : currencies[0] ?? null;
  const label = range.label.toLowerCase();

  return (
    <>
      <AdminPageHeader
        title="Revenue"
        description="Verified Paystack payments, recurring revenue and subscription movement."
        actions={<><DateRangeControl /><ExportButton dataset="transactions" filters={{ from: range.fromIso, to: range.toIso, status: "success" }} label="Export payments" /></>}
      />
      {q.isLoading ? <LoadingTiles /> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data.tracking_since ? (
        <EmptyNote>Payment data not connected: no Paystack transaction has been recorded yet.</EmptyNote>
      ) : (() => {
        const r = q.data;
        const c = r.by_currency.find((x) => x.currency === currency);
        const mrr = r.mrr.find((x) => x.currency === currency);
        const arppu = c && c.paying_workspaces ? Math.round((c.gross_minor ?? 0) / c.paying_workspaces) : null;
        const subs = r.subscriptions;
        const live = (subs.by_status.active ?? 0) + (subs.by_status.past_due ?? 0) + (subs.by_status.grace ?? 0);
        return (
          <>
            {currencies.length > 1 ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Currency">
                {currencies.map((cur) => <Button key={cur} size="sm" variant={cur === currency ? "default" : "outline"} onClick={() => setPicked(cur)}>{cur}</Button>)}
              </div>
            ) : null}
            {!currency ? <EmptyNote>No payments or subscriptions yet.</EmptyNote> : (
              <StatGrid>
                <StatTile label="Gross revenue" value={formatMoney(c?.gross_minor ?? 0, currency)} sub={`${formatCount(c?.successful ?? 0)} payments · ${label}`} help="Successful, verified Paystack transactions paid in this currency within the range." href={`/admin/transactions${carry}${carry ? "&" : "?"}status=success`} />
                <StatTile label="MRR" value={formatMoney(mrr?.mrr_minor ?? 0, currency)} sub={`${formatCount(mrr?.active ?? 0)} active subscriptions`} help="Monthly price of every active subscription (annual ÷ 12). Excludes past-due and grace." />
                <StatTile label="ARR" value={formatMoney((mrr?.mrr_minor ?? 0) * 12, currency)} sub="MRR × 12" help="Annualised run-rate of current MRR. Not a forecast." />
                <StatTile label="At-risk MRR" value={formatMoney(mrr?.at_risk_minor ?? 0, currency)} sub="Past due or in grace" tone={(mrr?.at_risk_minor ?? 0) > 0 ? "warning" : "default"} href="/admin/subscriptions?status=past_due" />
                <StatTile label="Paying businesses" value={formatCount(c?.paying_workspaces ?? 0)} sub={`with a payment ${label}`} />
                <StatTile label="ARPPU" value={arppu === null ? "—" : formatMoney(arppu, currency)} sub={`Revenue ÷ paying businesses · ${label}`} help="Average revenue per paying business: gross revenue in the range divided by the number of businesses that paid in the range." />
                <StatTile label="Failed payments" value={formatCount(c?.failed ?? 0)} sub={`${formatCount(c?.abandoned ?? 0)} checkouts abandoned`} tone={(c?.failed ?? 0) > 0 ? "warning" : "default"} href="/admin/transactions?status=failed" />
                <StatTile label="Reversed" value={formatMoney(c?.reversed_minor ?? 0, currency)} sub={label} tone={(c?.reversed_minor ?? 0) > 0 ? "danger" : "default"} />
              </StatGrid>
            )}

            {currency ? (
              <Section title={`Daily revenue · ${currency}`}>
                <ColumnChart title={`Revenue (${currency})`} points={r.series.filter((s) => s.currency === currency).map((s) => ({ date: s.date, value: s.gross_minor }))} format={(v) => formatMoney(v, currency, { compact: true })} />
              </Section>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              <Section title="Revenue by plan" description={label}>
                {r.by_plan.length === 0 ? <EmptyNote>No payments in this range.</EmptyNote> : (
                  <DataTable minWidth={420}>
                    <thead><tr><Th>Plan</Th><Th className="text-right">Payments</Th><Th className="text-right">Gross</Th></tr></thead>
                    <tbody>{r.by_plan.map((p) => <tr key={`${p.plan}-${p.currency}`}><Td>{p.plan}</Td><Td className="text-right tabular-nums">{p.transactions}</Td><Td className="text-right tabular-nums">{formatMoney(p.gross_minor, p.currency)}</Td></tr>)}</tbody>
                  </DataTable>
                )}
              </Section>
              <Section title="Subscriptions" description={`Movement ${label}; status counts are current`}>
                <StatGrid className="md:grid-cols-2 xl:grid-cols-2">
                  <StatTile label="Live now" value={formatCount(live)} sub={Object.entries(subs.by_status).map(([k, v]) => `${v} ${humanize(k).toLowerCase()}`).join(" · ") || "None"} href="/admin/subscriptions" />
                  <StatTile label="Started" value={formatCount(subs.started)} sub={label} />
                  <StatTile label="Renewals" value={formatCount(subs.renewals)} sub="successful renewal charges" />
                  <StatTile label="Cancelled / expired" value={`${formatCount(subs.cancelled)} / ${formatCount(subs.expired)}`} sub={label} />
                </StatGrid>
                {r.by_kind.length ? (
                  <p className="mt-3 text-xs text-muted-foreground">By type: {r.by_kind.map((k) => `${humanize(k.kind)} ${formatMoney(k.gross_minor, k.currency)}`).join(" · ")}</p>
                ) : null}
              </Section>
            </div>
            <p className="text-xs text-muted-foreground">
              Payment records start {formatDate(r.tracking_since)}. Churn and LTV are not shown yet: there is not enough subscription history to calculate them honestly. <Link to="/admin/transactions?view=webhooks" className="underline">Payment webhook log</Link>
            </p>
          </>
        );
      })()}
    </>
  );
}

export default function AdminRevenue() {
  return <RequirePermission permission="billing.read"><RevenueView /></RequirePermission>;
}

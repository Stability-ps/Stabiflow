import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CreditCard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AdminPageHeader, DataTable, EmptyNote, ErrorState, LoadingRows, Pager, RequirePermission, Section, Td, Th } from "@/components/admin/AdminPrimitives";
import { ExportButton } from "@/components/admin/ExportButton";
import { adminConsole, type AdminSubscription, type Paged } from "@/lib/adminApi";
import { formatDate, formatMoney, humanize } from "@/lib/adminFormat";

const PAGE_SIZE = 25;
const STATUSES = ["all", "active", "past_due", "grace", "cancelled", "expired", "incomplete"];

function SubscriptionsView() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "all";
  const page = Math.max(Number(params.get("page")) || 0, 0);
  const q = useQuery({
    queryKey: ["admin-subscriptions", status, page],
    queryFn: () => adminConsole<Paged<AdminSubscription>>("subscriptions", { status: status === "all" ? undefined : status, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <AdminPageHeader
        title="Subscriptions"
        description="Recurring Paystack subscriptions, their renewal dates and payment state. Plan changes and cancellations happen through the customer's billing page and Paystack, so every change stays traceable to a payment."
        actions={<ExportButton dataset="subscriptions" filters={{ status: status === "all" ? undefined : status }} />}
      />
      <Section title={q.data ? `${q.data.total.toLocaleString()} subscriptions` : "Subscriptions"}>
        <div className="space-y-4">
          <Select value={status} onValueChange={(v) => setParams(v === "all" ? {} : { status: v }, { replace: true })}>
            <SelectTrigger className="w-52" aria-label="Status"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : humanize(s)}</SelectItem>)}</SelectContent>
          </Select>
          {q.isLoading ? <LoadingRows rows={6} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data!.rows.length === 0 ? (
            <EmptyNote icon={CreditCard}>{status === "past_due" ? "No past-due subscriptions." : "No subscriptions match this filter."}</EmptyNote>
          ) : (
            <>
              <DataTable minWidth={820}>
                <thead><tr><Th>Business</Th><Th>Plan</Th><Th>Price</Th><Th>Status</Th><Th>Started</Th><Th>Current period ends</Th><Th>Notes</Th></tr></thead>
                <tbody className={q.isPlaceholderData ? "opacity-60" : undefined}>
                  {q.data!.rows.map((s) => (
                    <tr key={s.id}>
                      <Td><Link to={`/admin/businesses/${s.workspace_id}`} className="font-medium hover:underline">{s.workspaces?.name ?? "Business"}</Link></Td>
                      <Td className="text-xs">{s.billing_plans?.name ?? "—"}</Td>
                      <Td className="text-xs tabular-nums">{s.billing_prices ? `${formatMoney(s.billing_prices.amount_minor, s.billing_prices.currency)} / ${s.billing_prices.billing_interval}` : "—"}</Td>
                      <Td><Badge variant={s.status === "active" ? "secondary" : ["past_due", "grace"].includes(s.status) ? "destructive" : "outline"} className="text-[10px]">{humanize(s.status)}</Badge></Td>
                      <Td className="whitespace-nowrap text-xs">{formatDate(s.created_at)}</Td>
                      <Td className="whitespace-nowrap text-xs">{formatDate(s.current_period_end)}</Td>
                      <Td className="text-xs text-muted-foreground">
                        {s.cancel_at_period_end ? "Cancels at period end. " : ""}
                        {s.grace_until ? `Grace until ${formatDate(s.grace_until)}. ` : ""}
                        {s.cancelled_at ? `Cancelled ${formatDate(s.cancelled_at)}.` : ""}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
              <Pager page={page} pageSize={PAGE_SIZE} total={q.data!.total} onPage={(p) => { const n = new URLSearchParams(params); n.set("page", String(p)); setParams(n, { replace: true }); }} />
            </>
          )}
        </div>
      </Section>
    </>
  );
}

export default function AdminSubscriptions() {
  return <RequirePermission permission="billing.read"><SubscriptionsView /></RequirePermission>;
}

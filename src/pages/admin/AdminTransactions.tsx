import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Receipt, Search, Webhook } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminPageHeader, DataTable, EmptyNote, ErrorState, LoadingRows, Pager, RequirePermission, Section, Td, Th } from "@/components/admin/AdminPrimitives";
import { ExportButton } from "@/components/admin/ExportButton";
import { adminConsole, type AdminTransaction, type AdminWebhookEvent, type Paged } from "@/lib/adminApi";
import { resolveRange } from "@/lib/adminDateRange";
import { formatDateTime, formatMoney, humanize } from "@/lib/adminFormat";

const PAGE_SIZE = 25;
const STATUSES = ["all", "success", "failed", "amount_mismatch", "reversed", "initialized", "abandoned"];
const KINDS = ["all", "purchase", "subscription_initial", "subscription_renewal"];
const HOOK_STATUSES = ["all", "processed", "failed", "ignored", "received"];

function TxnStatus({ status }: { status: string }) {
  const v = status === "success" ? "secondary" : ["failed", "amount_mismatch", "reversed"].includes(status) ? "destructive" : "outline";
  return <Badge variant={v} className="text-[10px]">{humanize(status)}</Badge>;
}

function TransactionsView() {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "webhooks" ? "webhooks" : "transactions";
  const status = params.get("status") ?? "all";
  const kind = params.get("kind") ?? "all";
  const ref = params.get("q") ?? "";
  const page = Math.max(Number(params.get("page")) || 0, 0);
  const hasRange = params.has("range");
  const range = resolveRange(params);
  const [text, setText] = useState(ref);
  const [synced, setSynced] = useState(ref);
  if (synced !== ref) {
    setSynced(ref);
    setText(ref);
  }

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || v === "all") next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  };
  useEffect(() => {
    if (text === ref) return;
    const t = setTimeout(() => set({ q: text.trim() || null }), 300);
    return () => clearTimeout(t);
  });

  const filters = {
    status: status === "all" ? undefined : status, kind: kind === "all" ? undefined : kind, q: ref || undefined,
    ...(hasRange ? { from: range.from.toISOString(), to: range.to.toISOString() } : {}),
  };
  const txns = useQuery({
    queryKey: ["admin-transactions", filters, page],
    queryFn: () => adminConsole<Paged<AdminTransaction>>("transactions", { ...filters, page, pageSize: PAGE_SIZE }),
    enabled: view === "transactions",
    placeholderData: keepPreviousData,
  });
  const hooks = useQuery({
    queryKey: ["admin-webhooks", status, page],
    queryFn: () => adminConsole<Paged<AdminWebhookEvent>>("transactions", { view: "webhooks", status: status === "all" ? undefined : status, page, pageSize: PAGE_SIZE }),
    enabled: view === "webhooks",
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <AdminPageHeader
        title="Transactions"
        description="Every Paystack checkout and charge, and the webhook events that confirmed them. Amounts are shown in the original currency."
        actions={view === "transactions" ? <ExportButton dataset="transactions" filters={filters} /> : null}
      />
      <Tabs value={view} onValueChange={(v) => setParams(v === "webhooks" ? { view: "webhooks" } : {}, { replace: true })}>
        <TabsList>
          <TabsTrigger value="transactions"><Receipt className="mr-1.5 h-3.5 w-3.5" />Transactions</TabsTrigger>
          <TabsTrigger value="webhooks"><Webhook className="mr-1.5 h-3.5 w-3.5" />Payment webhooks</TabsTrigger>
        </TabsList>
      </Tabs>

      {view === "transactions" ? (
        <Section title={txns.data ? `${txns.data.total.toLocaleString()} transactions${hasRange ? ` · ${range.label.toLowerCase()}` : ""}` : "Transactions"}>
          <div className="space-y-4">
            <div className="flex flex-col gap-2 md:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by payment reference" aria-label="Search by payment reference" />
              </div>
              <Select value={status} onValueChange={(v) => set({ status: v })}>
                <SelectTrigger className="md:w-48" aria-label="Status"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : humanize(s)}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={kind} onValueChange={(v) => set({ kind: v })}>
                <SelectTrigger className="md:w-52" aria-label="Type"><SelectValue /></SelectTrigger>
                <SelectContent>{KINDS.map((s) => <SelectItem key={s} value={s}>{s === "all" ? "All types" : humanize(s)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {txns.isLoading ? <LoadingRows rows={8} /> : txns.error ? <ErrorState error={txns.error} onRetry={() => void txns.refetch()} /> : txns.data!.rows.length === 0 ? (
              <EmptyNote icon={Receipt}>{status === "failed" ? "No failed payments." : "No transactions match these filters."}</EmptyNote>
            ) : (
              <>
                <DataTable minWidth={900}>
                  <thead><tr><Th>Reference</Th><Th>Business</Th><Th>Plan</Th><Th>Type</Th><Th>Amount</Th><Th>Status</Th><Th>Created</Th><Th>Paid</Th></tr></thead>
                  <tbody className={txns.isPlaceholderData ? "opacity-60" : undefined}>
                    {txns.data!.rows.map((t) => (
                      <tr key={t.id} className="hover:bg-accent/30">
                        <Td><button type="button" className="font-mono text-xs hover:underline" title="Copy reference" onClick={() => void navigator.clipboard?.writeText(t.reference).then(() => toast.success("Reference copied"))}>{t.reference}</button></Td>
                        <Td className="text-xs">{t.workspace_id ? <Link to={`/admin/businesses/${t.workspace_id}`} className="hover:underline">{t.workspaces?.name ?? "Business"}</Link> : "—"}</Td>
                        <Td className="text-xs">{t.billing_prices?.billing_plans?.name ?? "—"}{t.billing_prices ? <span className="text-muted-foreground"> · {t.billing_prices.billing_interval}</span> : null}</Td>
                        <Td className="text-xs">{humanize(t.kind)}</Td>
                        <Td className="text-xs tabular-nums">
                          {formatMoney(t.amount_minor, t.currency)}
                          {t.paid_amount_minor !== null && (t.paid_amount_minor !== t.amount_minor || (t.paid_currency && t.paid_currency !== t.currency)) ? <span className="block text-destructive">paid {formatMoney(t.paid_amount_minor, t.paid_currency ?? t.currency)}</span> : null}
                        </Td>
                        <Td><TxnStatus status={t.status} />{t.failure_reason ? <span className="mt-0.5 block text-[11px] text-muted-foreground">{t.failure_reason}</span> : null}</Td>
                        <Td className="whitespace-nowrap text-xs">{formatDateTime(t.created_at)}</Td>
                        <Td className="whitespace-nowrap text-xs">{t.paid_at ? <>{formatDateTime(t.paid_at)}{t.verified_via ? <span className="block text-muted-foreground">via {t.verified_via}</span> : null}</> : "—"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
                <Pager page={page} pageSize={PAGE_SIZE} total={txns.data!.total} onPage={(p) => set({ page: String(p) })} />
              </>
            )}
          </div>
        </Section>
      ) : (
        <Section title={hooks.data ? `${hooks.data.total.toLocaleString()} webhook events` : "Payment webhooks"} description="Signature check and processing result for every event Paystack sent. Payloads are not shown.">
          <div className="space-y-4">
            <Select value={status} onValueChange={(v) => set({ status: v })}>
              <SelectTrigger className="w-48" aria-label="Processing status"><SelectValue /></SelectTrigger>
              <SelectContent>{HOOK_STATUSES.map((s) => <SelectItem key={s} value={s}>{s === "all" ? "All results" : humanize(s)}</SelectItem>)}</SelectContent>
            </Select>
            {hooks.isLoading ? <LoadingRows rows={8} /> : hooks.error ? <ErrorState error={hooks.error} onRetry={() => void hooks.refetch()} /> : hooks.data!.rows.length === 0 ? (
              <EmptyNote icon={Webhook}>{status === "failed" ? "No failed webhook events." : "No webhook events."}</EmptyNote>
            ) : (
              <>
                <DataTable minWidth={760}>
                  <thead><tr><Th>Event</Th><Th>Business</Th><Th>Signature</Th><Th>Result</Th><Th>Received</Th><Th>Processing time</Th></tr></thead>
                  <tbody>
                    {hooks.data!.rows.map((e) => (
                      <tr key={e.id}>
                        <Td className="text-xs"><span className="font-medium">{e.event_type}</span><span className="block text-muted-foreground">{e.provider}</span></Td>
                        <Td className="text-xs">{e.workspace_id ? <Link to={`/admin/businesses/${e.workspace_id}`} className="hover:underline">{e.workspaces?.name ?? "Business"}</Link> : "—"}</Td>
                        <Td>{e.signature_valid ? <Badge variant="secondary" className="text-[10px]">valid</Badge> : <Badge variant="destructive" className="text-[10px]">invalid</Badge>}</Td>
                        <Td className="text-xs"><TxnStatus status={e.processing_status === "processed" ? "success" : e.processing_status} />{e.processing_result ? <span className="mt-0.5 block text-[11px] text-muted-foreground">{e.processing_result}</span> : null}</Td>
                        <Td className="whitespace-nowrap text-xs">{formatDateTime(e.received_at)}</Td>
                        <Td className="text-xs tabular-nums">{e.processed_at ? `${Math.max(new Date(e.processed_at).getTime() - new Date(e.received_at).getTime(), 0).toLocaleString()} ms` : "—"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
                <Pager page={page} pageSize={PAGE_SIZE} total={hooks.data!.total} onPage={(p) => set({ page: String(p) })} />
              </>
            )}
          </div>
        </Section>
      )}
    </>
  );
}

export default function AdminTransactions() {
  return <RequirePermission permission="billing.read"><TransactionsView /></RequirePermission>;
}

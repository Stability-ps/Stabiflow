import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMoney } from "@/lib/billing";
import { operatorAdmin } from "@/lib/operatorAdmin";

type Sub = {
  id: string; status: string; current_period_end: string | null; grace_until: string | null; created_at: string; provider_subscription_code: string | null;
  workspaces: { name: string } | null; billing_plans: { name: string } | null; billing_prices: { amount_minor: number; currency: string; billing_interval: string } | null;
};
type Txn = {
  id: string; reference: string; kind: string; status: string; amount_minor: number; currency: string; paid_amount_minor: number | null;
  paid_at: string | null; verified_via: string | null; failure_reason: string | null; created_at: string; workspaces: { name: string } | null;
};
type Evt = { id: string; event_type: string; signature_valid: boolean; processing_status: string; processing_result: string | null; received_at: string };

const d = (v: string | null) => (v ? new Date(v).toLocaleString() : "-");
const ALL = "all";

function Filter({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-44" aria-label="Filter by status">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All statuses</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o.replace(/_/g, " ")}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Subscriptions, Paystack payments and webhook deliveries (read-only). */
export function OperatorBilling() {
  const [subStatus, setSubStatus] = useState(ALL);
  const [txnStatus, setTxnStatus] = useState(ALL);
  const [evtStatus, setEvtStatus] = useState(ALL);
  const subs = useQuery({ queryKey: ["op-subs", subStatus], queryFn: () => operatorAdmin<{ subscriptions: Sub[] }>("list_subscriptions", { status: subStatus === ALL ? "" : subStatus }) });
  const txns = useQuery({ queryKey: ["op-txns", txnStatus], queryFn: () => operatorAdmin<{ transactions: Txn[] }>("list_transactions", { status: txnStatus === ALL ? "" : txnStatus }) });
  const evts = useQuery({ queryKey: ["op-evts", evtStatus], queryFn: () => operatorAdmin<{ events: Evt[] }>("list_webhook_events", { status: evtStatus === ALL ? "" : evtStatus }) });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Subscriptions</CardTitle>
          <Filter value={subStatus} onChange={setSubStatus} options={["incomplete", "active", "past_due", "grace", "cancelled", "expired"]} />
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="py-1 pr-3 font-normal">Workspace</th><th className="pr-3 font-normal">Plan</th><th className="pr-3 font-normal">Price</th><th className="pr-3 font-normal">Status</th><th className="pr-3 font-normal">Period end</th><th className="font-normal">Grace until</th></tr>
            </thead>
            <tbody>
              {(subs.data?.subscriptions ?? []).map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="py-1 pr-3">{s.workspaces?.name}</td>
                  <td className="pr-3">{s.billing_plans?.name}</td>
                  <td className="pr-3">{s.billing_prices ? `${formatMoney(s.billing_prices.amount_minor, s.billing_prices.currency)}/${s.billing_prices.billing_interval}` : "-"}</td>
                  <td className="pr-3"><Badge variant={s.status === "active" ? "default" : "outline"}>{s.status}</Badge></td>
                  <td className="pr-3">{d(s.current_period_end)}</td>
                  <td>{d(s.grace_until)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Paystack payments</CardTitle>
          <Filter value={txnStatus} onChange={setTxnStatus} options={["initialized", "success", "failed", "abandoned", "amount_mismatch", "reversed"]} />
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="py-1 pr-3 font-normal">Date</th><th className="pr-3 font-normal">Workspace</th><th className="pr-3 font-normal">Type</th><th className="pr-3 font-normal">Amount</th><th className="pr-3 font-normal">Status</th><th className="pr-3 font-normal">Verified via</th><th className="font-normal">Reference</th></tr>
            </thead>
            <tbody>
              {(txns.data?.transactions ?? []).map((t) => (
                <tr key={t.id} className="border-t align-top">
                  <td className="py-1 pr-3">{d(t.paid_at ?? t.created_at)}</td>
                  <td className="pr-3">{t.workspaces?.name}</td>
                  <td className="pr-3">{t.kind.replace(/_/g, " ")}</td>
                  <td className="pr-3">
                    {formatMoney(t.amount_minor, t.currency)}
                    {t.paid_amount_minor !== null && t.paid_amount_minor !== t.amount_minor && <span className="block text-xs text-destructive">paid {formatMoney(t.paid_amount_minor, t.currency)}</span>}
                  </td>
                  <td className="pr-3">
                    <Badge variant={t.status === "success" ? "default" : t.status === "amount_mismatch" ? "destructive" : "outline"}>{t.status}</Badge>
                    {t.failure_reason && <span className="block text-xs text-muted-foreground">{t.failure_reason}</span>}
                  </td>
                  <td className="pr-3">{t.verified_via ?? "-"}</td>
                  <td className="font-mono text-xs">{t.reference}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Paystack webhook deliveries</CardTitle>
          <Filter value={evtStatus} onChange={setEvtStatus} options={["received", "processed", "ignored", "failed"]} />
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="py-1 pr-3 font-normal">Received</th><th className="pr-3 font-normal">Event</th><th className="pr-3 font-normal">Signature</th><th className="pr-3 font-normal">Status</th><th className="font-normal">Result</th></tr>
            </thead>
            <tbody>
              {(evts.data?.events ?? []).map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="py-1 pr-3">{d(e.received_at)}</td>
                  <td className="pr-3">{e.event_type}</td>
                  <td className="pr-3">{e.signature_valid ? "valid" : <span className="text-destructive">invalid</span>}</td>
                  <td className="pr-3"><Badge variant={e.processing_status === "failed" ? "destructive" : "outline"}>{e.processing_status}</Badge></td>
                  <td className="text-xs text-muted-foreground">{e.processing_result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

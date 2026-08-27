import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRevenueEventsForOpportunity } from "@/hooks/useAttribution";
import { recordRevenue } from "@/lib/attribution";

const EVENT_TYPES = ["sale", "payment", "contract_value", "adjustment", "refund"] as const;

function formatMinor(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amountMinor / 100);
}

/**
 * Simple manual "Record Revenue" form plus a list of what's been recorded
 * against this opportunity - deliberately NOT an invoicing/accounting UI.
 * amount_minor + currency are entered together and never blindly summed
 * across currencies here (that's a later analytics phase's job) - each
 * event is just listed with its own currency.
 */
export function RevenueSection({ workspaceId, opportunityId, customerId, leadId, canRecord }: {
  workspaceId: string;
  opportunityId: string;
  customerId: string | null;
  leadId: string | null;
  canRecord: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: events } = useRevenueEventsForOpportunity(workspaceId, opportunityId);
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [eventType, setEventType] = useState<(typeof EVENT_TYPES)[number]>("sale");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);

  const handleRecord = async () => {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed === 0) {
      toast.error("Enter a non-zero amount");
      return;
    }
    const amountMinor = Math.round((eventType === "adjustment" || eventType === "refund" ? -Math.abs(parsed) : Math.abs(parsed)) * 100);
    setBusy(true);
    try {
      await recordRevenue(workspaceId, { amountMinor, currency: currency.toUpperCase(), eventType, opportunityId, customerId, leadId, reference: reference || undefined });
      setAmount("");
      setReference("");
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["revenue-events", "opportunity", workspaceId, opportunityId] });
      toast.success("Revenue recorded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to record revenue");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border p-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">Revenue</p>
        {canRecord && <Button size="sm" variant="ghost" onClick={() => setShowForm((v) => !v)}>Record revenue</Button>}
      </div>
      {(events || []).length === 0 && !showForm && <p className="text-xs text-muted-foreground">No revenue recorded yet.</p>}
      {(events || []).map((e) => (
        <div key={e.id} className="flex items-center justify-between text-xs">
          <span>{e.event_type} - {formatMinor(e.amount_minor, e.currency)}{e.reference ? ` (${e.reference})` : ""}</span>
          <span className="text-muted-foreground">{new Date(e.occurred_at).toLocaleDateString()}</span>
        </div>
      ))}
      {showForm && (
        <div className="space-y-2 rounded-md border p-2">
          <div className="flex gap-2">
            <Input placeholder="Amount" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-8 text-xs" />
            <Input placeholder="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} className="h-8 w-20 text-xs" />
          </div>
          <Select value={eventType} onValueChange={(v) => setEventType(v as (typeof EVENT_TYPES)[number])}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {EVENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input placeholder="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} className="h-8 text-xs" />
          <Button size="sm" onClick={handleRecord} disabled={busy || !amount}>Save</Button>
        </div>
      )}
    </div>
  );
}

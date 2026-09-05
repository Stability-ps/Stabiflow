import { Badge } from "@/components/ui/badge";
import { SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCustomer, useOpportunity, useCrmNotes } from "@/hooks/useOpportunities";
import { useLead } from "@/hooks/useLeads";
import { opportunityStatusLabel } from "@/lib/opportunityLifecycle";
import { AttributionSourceSummary } from "@/components/attribution/AttributionSourceSummary";
import { RevenueSection } from "@/components/attribution/RevenueSection";

const OPPORTUNITY_STATUS_TONE: Record<string, string> = {
  open: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  won: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  lost: "bg-muted text-muted-foreground",
};

/**
 * Read-only Customer detail - contact info, the originating lead/
 * opportunity, attribution (targetType="customer", the RPC has supported
 * this since Phase G/H - only the UI surface was missing), revenue events
 * recorded against the linked opportunity, and notes inherited from the
 * originating lead/opportunity (crm_notes has no "customer" target_type of
 * its own, by design - a customer's history IS its lead/opportunity
 * history, not a separate thread).
 */
export function CustomerDetail({ workspaceId, customerId, canRecordRevenue }: {
  workspaceId: string;
  customerId: string;
  canRecordRevenue: boolean;
}) {
  const { data: customer } = useCustomer(customerId);
  const { data: lead } = useLead(customer?.lead_id ?? null);
  const { data: opportunity } = useOpportunity(customer?.opportunity_id ?? null);
  const { data: leadNotes } = useCrmNotes("lead", customer?.lead_id ?? null);
  const { data: opportunityNotes } = useCrmNotes("opportunity", customer?.opportunity_id ?? null);

  if (!customer) {
    return (
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Customer</SheetTitle>
          <SheetDescription>Loading...</SheetDescription>
        </SheetHeader>
      </SheetContent>
    );
  }

  const notes = [
    ...(leadNotes || []).map((n) => ({ ...n, from: "lead" as const })),
    ...(opportunityNotes || []).map((n) => ({ ...n, from: "opportunity" as const })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
      <SheetHeader>
        <SheetTitle>{customer.name}</SheetTitle>
        <SheetDescription>Customer since {new Date(customer.customer_since).toLocaleDateString()}</SheetDescription>
      </SheetHeader>

      <div className="mt-4 space-y-4">
        <section className="space-y-1 rounded-md border p-3 text-sm">
          {customer.company_name && <p><span className="text-muted-foreground">Company:</span> {customer.company_name}</p>}
          {customer.phone && <p><span className="text-muted-foreground">Phone:</span> {customer.phone}</p>}
          {customer.email && <p><span className="text-muted-foreground">Email:</span> {customer.email}</p>}
          {!customer.company_name && !customer.phone && !customer.email && <p className="text-muted-foreground">No additional contact details recorded.</p>}
        </section>

        <section className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Originating lead</p>
          {lead ? (
            <div className="rounded-md border p-2 text-xs">
              <p className="font-medium">{lead.contact_name || lead.human_reference}</p>
              <p className="text-muted-foreground">{lead.source}{lead.source_detail ? ` - ${lead.source_detail}` : ""}</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No linked lead on record.</p>
          )}
        </section>

        <section className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Originating opportunity</p>
          {opportunity ? (
            <div className="flex items-center justify-between rounded-md border p-2 text-xs">
              <div>
                <p className="font-medium">{opportunity.title}</p>
                {opportunity.actual_value != null && <p className="text-muted-foreground">Deal value: {opportunity.actual_value}</p>}
              </div>
              <Badge variant="secondary" className={OPPORTUNITY_STATUS_TONE[opportunity.status]}>{opportunityStatusLabel(opportunity.status)}</Badge>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No linked opportunity on record.</p>
          )}
        </section>

        <section className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Acquired via</p>
          <AttributionSourceSummary workspaceId={workspaceId} targetType="customer" targetId={customerId} fallbackLabel="No attribution evidence recorded for this customer - organic, manual, or unknown source." />
        </section>

        {customer.opportunity_id && (
          <section>
            <RevenueSection workspaceId={workspaceId} opportunityId={customer.opportunity_id} customerId={customer.id} leadId={customer.lead_id} canRecord={canRecordRevenue} />
          </section>
        )}

        <section className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Notes</p>
          {notes.length === 0 && <p className="text-xs text-muted-foreground">No notes yet.</p>}
          {notes.map((n) => (
            <p key={n.id} className="rounded-md bg-amber-50 p-2 text-xs dark:bg-amber-950/20">
              <span className="font-medium">{n.author_name}</span> <span className="text-muted-foreground">(from the {n.from})</span>: {n.body}
            </p>
          ))}
        </section>
      </div>
    </SheetContent>
  );
}

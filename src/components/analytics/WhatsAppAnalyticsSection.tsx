import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import type { WhatsAppAnalytics } from "@/hooks/useAnalytics";
import { safeRate } from "@/lib/analytics";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <dd className="text-lg font-semibold tabular-nums text-foreground">{typeof value === "number" ? value.toLocaleString() : value}</dd>
      <dt className="text-xs text-muted-foreground">{label}</dt>
    </div>
  );
}

export function WhatsAppAnalyticsSection({ data }: { data: WhatsAppAnalytics }) {
  const convToLead = safeRate(data.conversations_started, data.became_leads);
  const convToCustomer = safeRate(data.conversations_started, data.became_customers);

  return (
    <Panel aria-labelledby="analytics-whatsapp">
      <PanelHeader titleId="analytics-whatsapp" title="WhatsApp conversion" />
      <PanelBody>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
          <Stat label="Conversations started" value={data.conversations_started} />
          <Stat label="Became leads" value={data.became_leads} />
          <Stat label="Became qualified" value={data.became_qualified} />
          <Stat label="Became customers" value={data.became_customers} />
          <Stat label="Conversation → lead" value={convToLead === null ? "—" : `${convToLead.toFixed(1)}%`} />
          <Stat label="Conversation → customer" value={convToCustomer === null ? "—" : `${convToCustomer.toFixed(1)}%`} />
          <Stat label="AI replies sent" value={data.ai_reply_count} />
          <Stat label="Staff replies sent" value={data.staff_reply_count} />
        </dl>
      </PanelBody>
    </Panel>
  );
}

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WhatsAppAnalytics } from "@/hooks/useAnalytics";
import { safeRate } from "@/lib/analytics";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export function WhatsAppAnalyticsSection({ data }: { data: WhatsAppAnalytics }) {
  const convToLead = safeRate(data.conversations_started, data.became_leads);
  const convToCustomer = safeRate(data.conversations_started, data.became_customers);

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">WhatsApp conversion</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Conversations started" value={data.conversations_started} />
          <Stat label="Became leads" value={data.became_leads} />
          <Stat label="Became qualified" value={data.became_qualified} />
          <Stat label="Became customers" value={data.became_customers} />
          <Stat label="Conversation → Lead rate" value={convToLead === null ? "—" : `${convToLead.toFixed(1)}%`} />
          <Stat label="Conversation → Customer rate" value={convToCustomer === null ? "—" : `${convToCustomer.toFixed(1)}%`} />
          <Stat label="AI replies sent" value={data.ai_reply_count} />
          <Stat label="Staff replies sent" value={data.staff_reply_count} />
        </div>
      </CardContent>
    </Card>
  );
}

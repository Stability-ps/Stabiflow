import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { roleHasPermission } from "@/lib/permissions";
import { useLastWhatsAppWebhookEvent } from "@/hooks/useWhatsAppStatus";
import { presentIntegrationStatus, toneClassName } from "@/lib/integrationStatus";
import { WhatsAppManagePanel } from "@/pages/dashboard/integrations/WhatsAppManagePanel";
import { useWhatsAppOutlet } from "@/pages/dashboard/whatsapp/whatsappOutlet";

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} day(s) ago`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b py-2 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm">{children}</span>
    </div>
  );
}

// WhatsApp > Settings: a product-facing view over the same connection
// state the Integrations page manages. It reuses WhatsAppManagePanel
// verbatim (chrome="page") for number activation / refresh / health /
// disconnect - no integration logic is duplicated here.
export default function WhatsAppSettings() {
  const { workspaceId, integration, numbers, activeNumbers } = useWhatsAppOutlet();
  const { currentMembership } = useAuth();
  const role = currentMembership?.role;
  const canManage = roleHasPermission(role, "integration.manage");
  const canDisconnect = roleHasPermission(role, "integration.disconnect");

  const { data: lastEvent } = useLastWhatsAppWebhookEvent(workspaceId);
  const status = presentIntegrationStatus(integration.last_health_check_status, integration.status === "connected");
  const wabaId = numbers.find((n) => n.waba_id)?.waba_id ?? null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Connection &amp; production wiring</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <Row label="WhatsApp Business Account">{wabaId ? <code className="text-xs">{wabaId}</code> : <span className="text-muted-foreground">Not discovered</span>}</Row>
          <Row label="Phone numbers">
            {numbers.length === 0 ? (
              <span className="text-muted-foreground">None found</span>
            ) : (
              <span>{activeNumbers.length} active / {numbers.length} total</span>
            )}
          </Row>
          <Row label="Active number (used for send + inbound)">
            {activeNumbers.length > 0 ? (
              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {activeNumbers[0].display_phone_number || activeNumbers[0].verified_name || activeNumbers[0].phone_number_id}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" /> None active - inbound messages are ignored
              </span>
            )}
          </Row>
          <Row label="Integration health">
            <span className="inline-flex items-center gap-2">
              <Badge className={toneClassName(status.tone)}>{status.label}</Badge>
              <span className="text-xs text-muted-foreground">checked {relativeTime(integration.last_health_check_at)}</span>
            </span>
          </Row>
          <Row label="Last inbound webhook event">
            {lastEvent ? <span>{lastEvent.event_type} · {relativeTime(lastEvent.received_at)}</span> : <span className="text-muted-foreground">No inbound events received yet</span>}
          </Row>
          <Row label="Webhook subscription">
            <span className="text-muted-foreground">Status unavailable</span>
          </Row>
        </CardContent>
      </Card>
      {!lastEvent && (
        <p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          StabiFlow cannot confirm the webhook subscription automatically. If no conversations are arriving, verify in Meta that the WhatsApp Business Account is subscribed to this app&apos;s webhook and that the callback URL and verify token are set.
        </p>
      )}

      <div className="rounded-lg border p-4">
        <WhatsAppManagePanel
          workspaceId={workspaceId}
          integration={integration}
          canManage={canManage}
          canDisconnect={canDisconnect}
          onDisconnected={() => { /* layout re-derives connection state on the integrations query refetch */ }}
          chrome="page"
        />
      </div>
    </div>
  );
}

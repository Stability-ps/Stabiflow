import type { ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { AlertTriangle, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { roleHasPermission } from "@/lib/permissions";
import { useAllWhatsAppNumbers, useWorkspaceIntegrations } from "@/hooks/useIntegrations";
import { useLastWhatsAppWebhookEvent } from "@/hooks/useWhatsAppStatus";
import { presentIntegrationStatus, presentWebhookSubscription, toneClassName } from "@/lib/integrationStatus";
import type { WhatsAppNumber, WhatsAppOutletContext } from "@/pages/dashboard/whatsapp/whatsappOutlet";

const TABS: Array<{ label: string; to: string; external?: boolean }> = [
  { label: "Inbox", to: "/app/whatsapp/inbox" },
  { label: "Contacts", to: "/app/whatsapp/contacts" },
  { label: "Templates", to: "/app/whatsapp/templates" },
  { label: "Automations", to: "/app/automations?trigger=conversation", external: true },
  { label: "Analytics", to: "/app/analytics?whatsapp", external: true },
  { label: "Settings", to: "/app/whatsapp/settings" },
];

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

function StatusCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border p-2.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-sm">{children}</div>
    </div>
  );
}

export default function WhatsAppLayout() {
  const navigate = useNavigate();
  const { currentWorkspaceId, currentMembership } = useAuth();
  const role = currentMembership?.role;
  const canView = roleHasPermission(role, "inbox.view");
  const canManage = roleHasPermission(role, "inbox.manage");
  const canManageIntegration = roleHasPermission(role, "integration.manage");

  const { data: integrations, isLoading: integrationsLoading } = useWorkspaceIntegrations(currentWorkspaceId);
  const { data: numbers } = useAllWhatsAppNumbers(canView ? currentWorkspaceId : null);
  const { data: lastEvent } = useLastWhatsAppWebhookEvent(canView ? currentWorkspaceId : null);

  if (!currentWorkspaceId || integrationsLoading) {
    return <div className="h-[70vh] animate-pulse rounded-lg bg-muted" />;
  }

  if (!canView) {
    return (
      <EmptyState
        icon={MessageCircle}
        title="WhatsApp"
        description="You don't have permission to view this workspace's WhatsApp conversations. Ask a workspace owner or admin."
      />
    );
  }

  const integration = (integrations || []).find((i) => i.provider === "whatsapp" && i.status === "connected");
  if (!integration) {
    return (
      <EmptyState
        icon={MessageCircle}
        title="Connect WhatsApp Business"
        description="Connect WhatsApp Business to use Inbox, templates, contacts and automations."
        action={<Button onClick={() => navigate("/app/integrations")}>Connect WhatsApp</Button>}
      />
    );
  }

  const allNumbers = (numbers || []) as WhatsAppNumber[];
  const activeNumbers = allNumbers.filter((n) => n.is_active);
  const status = presentIntegrationStatus(integration.last_health_check_status, integration.status === "connected");
  const webhook = presentWebhookSubscription(integration.webhook_subscription_status, !!lastEvent);
  const primary = activeNumbers[0] || null;

  const context: WhatsAppOutletContext = {
    workspaceId: currentWorkspaceId,
    canView,
    canManage,
    numbers: allNumbers,
    activeNumbers,
    integration,
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">WhatsApp</h1>
        <p className="text-sm text-muted-foreground">Conversations, contacts, templates and automations for your connected WhatsApp Business number.</p>
      </div>

      {/* Production wiring indicators - all derived from real state, never
          assumed healthy. */}
      <section aria-label="WhatsApp connection status" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <StatusCell label="Active number">
          {primary ? (
            <span className="block truncate">
              {primary.verified_name || primary.display_phone_number || primary.phone_number_id}
              {primary.display_phone_number && primary.verified_name ? (
                <span className="block truncate text-xs text-muted-foreground">{primary.display_phone_number}</span>
              ) : null}
              {activeNumbers.length > 1 && <span className="block text-xs text-muted-foreground">+{activeNumbers.length - 1} more active</span>}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" /> No active number
            </span>
          )}
        </StatusCell>

        <StatusCell label="Integration health">
          <Badge className={toneClassName(status.tone)}>{status.label}</Badge>
          <span className="mt-1 block text-xs text-muted-foreground">Checked {relativeTime(integration.last_health_check_at)}</span>
        </StatusCell>

        <StatusCell label="Last inbound event">
          {lastEvent ? (
            <span className="block truncate">
              {lastEvent.event_type}
              <span className="block text-xs text-muted-foreground">{relativeTime(lastEvent.received_at)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">No inbound events received yet</span>
          )}
        </StatusCell>

        <StatusCell label="Webhook subscription">
          <Badge className={toneClassName(webhook.tone)}>{webhook.label}</Badge>
          {webhook.hint && <span className="mt-1 block text-xs text-muted-foreground">{webhook.hint}</span>}
        </StatusCell>
      </section>

      {webhook.actionable && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>WhatsApp is connected but its webhook subscription is not confirmed - inbound messages may not arrive.</span>
          {canManageIntegration && (
            <Button size="sm" variant="outline" className="ml-auto h-7" onClick={() => navigate("/app/whatsapp/settings")}>
              Fix in Settings
            </Button>
          )}
        </div>
      )}

      <nav aria-label="WhatsApp sections" className="flex gap-1 overflow-x-auto border-b">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end
            title={tab.external ? `Open ${tab.label}, filtered to WhatsApp` : undefined}
            className={({ isActive }) =>
              cn(
                "shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                isActive && !tab.external
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )
            }
          >
            {tab.label}
            {tab.external && <span aria-hidden="true" className="ml-1 text-xs opacity-60">&#8599;</span>}
          </NavLink>
        ))}
      </nav>

      <Outlet context={context} />
    </div>
  );
}

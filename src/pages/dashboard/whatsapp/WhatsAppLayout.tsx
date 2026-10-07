import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { AlertTriangle, MessageCircle, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { roleHasPermission } from "@/lib/permissions";
import { useAllWhatsAppNumbers, useWorkspaceIntegrations } from "@/hooks/useIntegrations";
import { useLastWhatsAppWebhookEvent } from "@/hooks/useWhatsAppStatus";
import { presentWebhookSubscription } from "@/lib/integrationStatus";
import type { WhatsAppNumber, WhatsAppOutletContext } from "@/pages/dashboard/whatsapp/whatsappOutlet";

const TABS: Array<{ label: string; to: string; external?: boolean }> = [
  { label: "Inbox", to: "/app/whatsapp/inbox" },
  { label: "Contacts", to: "/app/whatsapp/contacts" },
  { label: "Templates", to: "/app/whatsapp/templates" },
  { label: "Intake", to: "/app/whatsapp/intake" },
  // Operational metrics (response time, handover, resolution). Its sidebar
  // link was removed with the duplicate Messages navigation and nothing
  // else linked to it, so it lives with the other Messages tabs.
  { label: "Analytics", to: "/app/whatsapp/analytics" },
];

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
    <div className="mx-auto w-full max-w-[1440px] space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-title-page text-foreground">Messages</h1>
        <nav aria-label="WhatsApp sections" className="order-3 flex w-full max-w-full gap-0.5 overflow-x-auto rounded-lg bg-muted p-0.5 sm:order-none sm:w-fit">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end
              title={tab.external ? `Open ${tab.label}, filtered to WhatsApp` : undefined}
              className={({ isActive }) =>
                cn(
                  "inline-flex min-h-9 shrink-0 items-center rounded-md px-3 text-sm font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive && !tab.external ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                )
              }
            >
              {tab.label}
              {tab.external && <span aria-hidden="true" className="ml-1 text-xs opacity-60">&#8599;</span>}
            </NavLink>
          ))}
        </nav>
        {canManageIntegration && (
          <Button variant="ghost" size="sm" className="ml-auto shrink-0 text-muted-foreground hover:text-foreground" onClick={() => navigate("/app/whatsapp/settings")} aria-label="Message settings">
            <Settings aria-hidden="true" />
            <span className="hidden lg:inline">Message settings</span>
          </Button>
        )}
      </div>

      {/* Keep the inbox conversation-first. Healthy production wiring belongs
          in Settings; only actionable problems interrupt the inbox. */}
      {!primary || webhook.actionable ? (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-warning-solid/40 bg-warning-soft px-3 py-2 text-sm text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{!primary ? "WhatsApp needs attention - no active number is configured." : "WhatsApp needs attention - inbound message delivery is not confirmed."}</span>
          {canManageIntegration && (
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => navigate("/app/whatsapp/settings")}>
              Fix
            </Button>
          )}
        </div>
      ) : null}

      <Outlet context={context} />
    </div>
  );
}

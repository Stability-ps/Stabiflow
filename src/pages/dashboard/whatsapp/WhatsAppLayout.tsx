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
    <div className="operational-page space-y-3">
      <div className="operational-header">
        <div>
          <p className="operational-section-label">Customer conversations</p><h1 className="operational-title">Messages</h1>
          <p className="hidden text-sm text-muted-foreground sm:block">Conversations, contacts, templates and intake for your connected WhatsApp Business number.</p>
        </div>
        {canManageIntegration && (
          <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" onClick={() => navigate("/app/whatsapp/settings")} aria-label="Message settings">
            <Settings className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* Keep the inbox conversation-first. Healthy production wiring belongs
          in Settings; only actionable problems interrupt the inbox. */}
      {!primary || webhook.actionable ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{!primary ? "WhatsApp needs attention - no active number is configured." : "WhatsApp needs attention - inbound message delivery is not confirmed."}</span>
          {canManageIntegration && (
            <Button size="sm" variant="outline" className="ml-auto h-8" onClick={() => navigate("/app/whatsapp/settings")}>
              Fix
            </Button>
          )}
        </div>
      ) : null}

      <nav aria-label="WhatsApp sections" className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg border border-border/70 bg-card p-1">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end
            title={tab.external ? `Open ${tab.label}, filtered to WhatsApp` : undefined}
            className={({ isActive }) =>
              cn(
                "shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-all",
                isActive && !tab.external
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
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

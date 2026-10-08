import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, Check, Facebook, Instagram, MessageCircle, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/hooks/useAuth";
import { roleHasPermission } from "@/lib/permissions";
import { IntegrationInvokeError, startIntegrationConnect, type IntegrationProvider } from "@/lib/integrations";
import { useAllFacebookPages, useAllInstagramAccounts, useAllMetaAdAccounts, useAllWhatsAppNumbers, useWorkspaceIntegrations, type WorkspaceIntegrationRow } from "@/hooks/useIntegrations";
import { presentIntegrationStatus, statusPillTone } from "@/lib/integrationStatus";
import { MetaManagePanel } from "./integrations/MetaManagePanel";
import { WhatsAppManagePanel } from "./integrations/WhatsAppManagePanel";
import { GuideHelpLink } from "@/components/guide/GuideHelpLink";

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "You cancelled the connection - nothing was connected.",
  invalid_request: "That connection link was invalid. Try connecting again.",
  invalid_state: "That connection link already expired or was already used. Try connecting again.",
  expired_state: "That connection attempt took too long and expired. Try connecting again.",
  forbidden: "You no longer have permission to connect this workspace.",
  expired_token: "The provider rejected the connection. Try again.",
  authorization_failure: "The provider rejected the connection. Try again.",
  meta_not_enabled: "Meta production connection is not enabled yet. Contact support to enable it.",
};

function resolveConnectErrorMessage(error: unknown): string {
  if (error instanceof IntegrationInvokeError && error.code && ERROR_MESSAGES[error.code]) {
    return ERROR_MESSAGES[error.code];
  }
  return "Unable to start integration connection. Please try again.";
}

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

function ProviderMark({ provider }: { provider: IntegrationProvider }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground" aria-hidden="true">
      {provider === "meta" ? <Facebook className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
    </span>
  );
}

function ConnectedIntegrationCard({ provider, integration, resourceCounts, onManage, canReconnect, reconnecting, onReconnect }: {
  provider: IntegrationProvider;
  integration: WorkspaceIntegrationRow;
  /** null while the resource lists are unavailable - never shown as 0. */
  resourceCounts: Array<{ label: string; count: number }> | null;
  onManage: () => void;
  canReconnect: boolean;
  reconnecting: boolean;
  onReconnect: () => void;
}) {
  const status = presentIntegrationStatus(integration.last_health_check_status, integration.status === "connected");
  // reauthorization_required/error both need the same fix (re-run OAuth) -
  // the OAuth callback upserts on (workspace_id, provider), so reconnecting
  // an already-connected integration replaces the token in place without
  // losing existing Page/number selections.
  const needsReconnect = status.tone === "error";
  const name = provider === "meta" ? "Meta" : "WhatsApp Business";
  return (
    <article aria-label={name} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <ProviderMark provider={provider} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-title-section text-foreground">{name}</h3>
            <StatusPill tone={statusPillTone(status.tone)}>{status.label}</StatusPill>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {resourceCounts ? resourceCounts.map((r) => `${r.label}: ${r.count}`).join(" · ") : "Couldn't load connected resources"}
          </p>
        </div>
      </div>
      {status.remediation && (
        <p className={status.tone === "error" ? "rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive-strong" : "rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning"}>
          {status.remediation}
        </p>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">Last checked {relativeTime(integration.last_health_check_at)}</p>
        <div className="flex gap-2">
          {needsReconnect && (
            <Button size="sm" onClick={onReconnect} disabled={!canReconnect || reconnecting}>
              {reconnecting ? "Reconnecting..." : "Reconnect"}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onManage}>Manage</Button>
        </div>
      </div>
    </article>
  );
}

function AvailableIntegrationCard({ provider, description, unlocks, canConnect, onConnect, connecting }: {
  provider: IntegrationProvider;
  description: string;
  unlocks: string[];
  canConnect: boolean;
  onConnect: () => void;
  connecting: boolean;
}) {
  const name = provider === "meta" ? "Meta" : "WhatsApp Business Platform";
  return (
    <article aria-label={name} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        {provider === "meta" ? (
          <span className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-muted px-2.5 text-foreground" aria-hidden="true"><Facebook className="h-4 w-4" /><Instagram className="h-4 w-4" /></span>
        ) : <ProviderMark provider={provider} />}
        <div className="min-w-0">
          <h3 className="text-title-section text-foreground">{name}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <ul className="space-y-1.5 text-sm text-foreground">
        {unlocks.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto space-y-2 pt-1">
        <Button onClick={onConnect} disabled={!canConnect || connecting}>
          {connecting ? "Connecting..." : "Connect"}
        </Button>
        {!canConnect && <p className="text-xs text-muted-foreground">Only a workspace owner or admin can connect providers.</p>}
      </div>
    </article>
  );
}

function ComingSoonCard({ label }: { label: string }) {
  return (
    <article aria-label={label} className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-background p-4">
      <div className="min-w-0">
        <h3 className="text-title-card text-foreground">{label}</h3>
        <p className="text-xs text-muted-foreground">Coming later</p>
      </div>
      <StatusPill tone="neutral" dot={false}>Soon</StatusPill>
    </article>
  );
}

export default function Integrations() {
  const { currentWorkspaceId, currentMembership } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: integrations, isLoading, isError, refetch } = useWorkspaceIntegrations(currentWorkspaceId);
  const { data: pages, isError: pagesError } = useAllFacebookPages(currentWorkspaceId);
  const { data: igAccounts, isError: igError } = useAllInstagramAccounts(currentWorkspaceId);
  const { data: adAccounts, isError: adError } = useAllMetaAdAccounts(currentWorkspaceId);
  const { data: whatsappNumbers, isError: numbersError } = useAllWhatsAppNumbers(currentWorkspaceId);

  const [managingProvider, setManagingProvider] = useState<IntegrationProvider | null>(null);
  const [connectingProvider, setConnectingProvider] = useState<IntegrationProvider | null>(null);

  const role = currentMembership?.role;
  const canView = roleHasPermission(role, "integration.view");
  const canConnect = roleHasPermission(role, "integration.connect");
  const canManage = roleHasPermission(role, "integration.manage");
  const canDisconnect = roleHasPermission(role, "integration.disconnect");

  useEffect(() => {
    const connected = searchParams.get("integration_connected");
    const errorCode = searchParams.get("integration_error");
    if (connected) {
      toast.success(`${connected === "meta" ? "Meta" : "WhatsApp"} connected. Choose which resources StabiFlow should use.`);
      setManagingProvider(connected as IntegrationProvider);
    } else if (errorCode) {
      toast.error(ERROR_MESSAGES[errorCode] || "Unable to complete that connection.");
    }
    if (connected || errorCode) {
      const next = new URLSearchParams(searchParams);
      next.delete("integration_connected");
      next.delete("integration_error");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = async (provider: IntegrationProvider) => {
    if (!currentWorkspaceId) return;
    setConnectingProvider(provider);
    try {
      const { url } = await startIntegrationConnect(currentWorkspaceId, provider);
      window.location.href = url;
    } catch (error) {
      toast.error(resolveConnectErrorMessage(error));
      setConnectingProvider(null);
    }
  };

  if (isLoading || !currentWorkspaceId) {
    return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  }

  if (!canView) {
    return (
      <EmptyState
        icon={Plug}
        title="Integrations"
        description="You don't have permission to view this workspace's connected providers. Ask a workspace owner or admin."
        className="rounded-xl border border-border bg-card"
      />
    );
  }

  const metaIntegration = integrations?.find((i) => i.provider === "meta" && i.status === "connected");
  const whatsappIntegration = integrations?.find((i) => i.provider === "whatsapp" && i.status === "connected");
  const managingIntegration = integrations?.find((i) => i.provider === managingProvider);

  // A failed resource read is "unknown", not 0 - otherwise we'd warn that
  // no Page is selected when we simply couldn't read the selection.
  const metaCounts = pagesError || igError || adError ? null : [
    { label: "Facebook Pages", count: pages?.filter((p) => p.is_active).length ?? 0 },
    { label: "Instagram Accounts", count: igAccounts?.filter((a) => a.is_active).length ?? 0 },
    { label: "Ad Accounts", count: adAccounts?.filter((a) => a.is_active).length ?? 0 },
  ];
  const whatsappCounts = numbersError ? null : [{ label: "Numbers", count: whatsappNumbers?.filter((n) => n.is_active).length ?? 0 }];

  const hasAnyConnection = !!metaIntegration || !!whatsappIntegration;

  const header = (
    <header className="min-w-0">
      <h1 className="text-title-page text-foreground">Integrations</h1>
      <p className="mt-1 text-sm text-muted-foreground">Connect Meta and WhatsApp Business to this workspace.</p>
      <GuideHelpLink chapter="integrations" className="mt-1" />
    </header>
  );

  // Never offer "Connect" when we couldn't read what is already connected:
  // that would invite a needless re-authorization over a working connection.
  if (isError) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-5">
        {header}
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load your integrations"
          description="We couldn't check which providers are connected. Your connections are unaffected - try again."
          action={<Button variant="outline" onClick={() => void refetch()}>Try again</Button>}
          className="rounded-xl border border-border bg-card"
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      {header}

      {hasAnyConnection ? (
        <section aria-labelledby="integrations-connected" className="space-y-3">
          <h2 id="integrations-connected" className="text-title-section text-foreground">Connected</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {metaIntegration && (
              <ConnectedIntegrationCard
                provider="meta"
                integration={metaIntegration}
                resourceCounts={metaCounts}
                onManage={() => setManagingProvider("meta")}
                canReconnect={canConnect}
                reconnecting={connectingProvider === "meta"}
                onReconnect={() => handleConnect("meta")}
              />
            )}
            {whatsappIntegration && (
              <ConnectedIntegrationCard
                provider="whatsapp"
                integration={whatsappIntegration}
                resourceCounts={whatsappCounts}
                onManage={() => setManagingProvider("whatsapp")}
                canReconnect={canConnect}
                reconnecting={connectingProvider === "whatsapp"}
                onReconnect={() => handleConnect("whatsapp")}
              />
            )}
          </div>
          {metaIntegration && metaCounts?.every((c) => c.count === 0) && (
            <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">Meta connected, no Page selected. Select at least one Facebook Page to publish content.</p>
          )}
        </section>
      ) : (
        <EmptyState icon={Plug} title="No integrations connected" description="Connect Meta or WhatsApp to start using StabiFlow." className="rounded-xl border border-border bg-card" />
      )}

      <section aria-labelledby="integrations-available" className="space-y-3">
        <h2 id="integrations-available" className="text-title-section text-foreground">Available integrations</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {!metaIntegration && (
            <AvailableIntegrationCard
              provider="meta"
              description="Connect to publish content, run campaigns, and track advertising performance."
              unlocks={[
                "Facebook Pages and Instagram accounts",
                "Meta Ad Accounts",
                "Content publishing to Facebook and Instagram",
                "Campaigns - build, publish, and manage ads",
                "Advertising performance and spend tracking",
              ]}
              canConnect={canConnect}
              connecting={connectingProvider === "meta"}
              onConnect={() => handleConnect("meta")}
            />
          )}
          {!whatsappIntegration && (
            <AvailableIntegrationCard
              provider="whatsapp"
              description="Connect to receive and reply to customer conversations."
              unlocks={[
                "Customer conversations in the Inbox",
                "AI-assisted replies, with human takeover any time",
                "Turn conversations into leads automatically",
                "Approved-template messaging outside the 24-hour window",
              ]}
              canConnect={canConnect}
              connecting={connectingProvider === "whatsapp"}
              onConnect={() => handleConnect("whatsapp")}
            />
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ComingSoonCard label="Google Ads" />
          <ComingSoonCard label="TikTok" />
        </div>
      </section>

      <Sheet open={!!managingProvider} onOpenChange={(open) => !open && setManagingProvider(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          {managingProvider === "meta" && managingIntegration && (
            <MetaManagePanel workspaceId={currentWorkspaceId} integration={managingIntegration} canManage={canManage} canDisconnect={canDisconnect} onDisconnected={() => setManagingProvider(null)} />
          )}
          {managingProvider === "whatsapp" && managingIntegration && (
            <WhatsAppManagePanel workspaceId={currentWorkspaceId} integration={managingIntegration} canManage={canManage} canDisconnect={canDisconnect} onDisconnected={() => setManagingProvider(null)} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

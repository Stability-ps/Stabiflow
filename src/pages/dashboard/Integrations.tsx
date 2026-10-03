import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Facebook, Instagram, MessageCircle, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/hooks/useAuth";
import { roleHasPermission } from "@/lib/permissions";
import { IntegrationInvokeError, startIntegrationConnect, type IntegrationProvider } from "@/lib/integrations";
import { useAllFacebookPages, useAllInstagramAccounts, useAllMetaAdAccounts, useAllWhatsAppNumbers, useWorkspaceIntegrations, type WorkspaceIntegrationRow } from "@/hooks/useIntegrations";
import { presentIntegrationStatus, toneClassName } from "@/lib/integrationStatus";
import { MetaManagePanel } from "./integrations/MetaManagePanel";
import { WhatsAppManagePanel } from "./integrations/WhatsAppManagePanel";

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

function ConnectedIntegrationCard({ provider, integration, resourceCounts, onManage, canReconnect, reconnecting, onReconnect }: {
  provider: IntegrationProvider;
  integration: WorkspaceIntegrationRow;
  resourceCounts: Array<{ label: string; count: number }>;
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
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            {provider === "meta" ? <Facebook className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
            {provider === "meta" ? "Meta" : "WhatsApp Business"}
          </CardTitle>
          <CardDescription>
            {resourceCounts.map((r) => `${r.label}: ${r.count}`).join(" · ")}
          </CardDescription>
        </div>
        <Badge className={toneClassName(status.tone)}>{status.label}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {status.remediation && (
          <p className={status.tone === "error" ? "text-sm text-red-700 dark:text-red-400" : "text-sm text-amber-700 dark:text-amber-400"}>
            {status.remediation}
          </p>
        )}
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Last checked: {relativeTime(integration.last_health_check_at)}</p>
          <div className="flex gap-2">
            {needsReconnect && (
              <Button size="sm" onClick={onReconnect} disabled={!canReconnect || reconnecting}>
                {reconnecting ? "Reconnecting..." : "Reconnect"}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={onManage}>Manage</Button>
          </div>
        </div>
      </CardContent>
    </Card>
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
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {provider === "meta" ? (
            <span className="flex items-center gap-1"><Facebook className="h-4 w-4" /> <Instagram className="h-4 w-4" /></span>
          ) : (
            <MessageCircle className="h-4 w-4" />
          )}
          {provider === "meta" ? "Meta" : "WhatsApp Business Platform"}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-1 text-xs text-muted-foreground">
          {unlocks.map((item) => (
            <li key={item} className="flex items-start gap-1.5">
              <span aria-hidden="true" className="mt-0.5">·</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <Button size="sm" onClick={onConnect} disabled={!canConnect || connecting}>
          {connecting ? "Connecting..." : "Connect"}
        </Button>
        {!canConnect && <p className="mt-2 text-xs text-muted-foreground">Only a workspace owner or admin can connect providers.</p>}
      </CardContent>
    </Card>
  );
}

function ComingSoonCard({ label }: { label: string }) {
  return (
    <Card className="opacity-60">
      <CardHeader>
        <CardTitle className="text-base">{label}</CardTitle>
        <CardDescription>Coming later.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button size="sm" disabled>Connect</Button>
      </CardContent>
    </Card>
  );
}

export default function Integrations() {
  const { currentWorkspaceId, currentMembership } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: integrations, isLoading } = useWorkspaceIntegrations(currentWorkspaceId);
  const { data: pages } = useAllFacebookPages(currentWorkspaceId);
  const { data: igAccounts } = useAllInstagramAccounts(currentWorkspaceId);
  const { data: adAccounts } = useAllMetaAdAccounts(currentWorkspaceId);
  const { data: whatsappNumbers } = useAllWhatsAppNumbers(currentWorkspaceId);

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
      />
    );
  }

  const metaIntegration = integrations?.find((i) => i.provider === "meta" && i.status === "connected");
  const whatsappIntegration = integrations?.find((i) => i.provider === "whatsapp" && i.status === "connected");
  const managingIntegration = integrations?.find((i) => i.provider === managingProvider);

  const metaCounts = [
    { label: "Facebook Pages", count: pages?.filter((p) => p.is_active).length ?? 0 },
    { label: "Instagram Accounts", count: igAccounts?.filter((a) => a.is_active).length ?? 0 },
    { label: "Ad Accounts", count: adAccounts?.filter((a) => a.is_active).length ?? 0 },
  ];
  const whatsappCounts = [{ label: "Numbers", count: whatsappNumbers?.filter((n) => n.is_active).length ?? 0 }];

  const hasAnyConnection = !!metaIntegration || !!whatsappIntegration;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Integrations</h1>
        <p className="text-sm text-muted-foreground">Connect Meta and WhatsApp Business to this workspace.</p>
      </div>

      {hasAnyConnection ? (
        <section>
          <h2 className="mb-3 text-lg font-medium">Connected</h2>
          <div className="grid gap-4 sm:grid-cols-2">
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
          {metaIntegration && metaCounts.every((c) => c.count === 0) && (
            <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">Meta connected, no Page selected. Select at least one Facebook Page to publish content.</p>
          )}
        </section>
      ) : (
        <EmptyState icon={Plug} title="No integrations connected" description="Connect Meta or WhatsApp to start using StabiFlow." />
      )}

      <section>
        <h2 className="mb-3 text-lg font-medium">Available integrations</h2>
        <div className="grid gap-4 sm:grid-cols-2">
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

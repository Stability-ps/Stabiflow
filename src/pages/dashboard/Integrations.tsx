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
import { startIntegrationConnect, type IntegrationProvider } from "@/lib/integrations";
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
};

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

function ConnectedIntegrationCard({ provider, integration, resourceCounts, onManage }: {
  provider: IntegrationProvider;
  integration: WorkspaceIntegrationRow;
  resourceCounts: Array<{ label: string; count: number }>;
  onManage: () => void;
}) {
  const status = presentIntegrationStatus(integration.last_health_check_status, integration.status === "connected");
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
      <CardContent className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Last checked: {relativeTime(integration.last_health_check_at)}</p>
        <Button size="sm" variant="outline" onClick={onManage}>Manage</Button>
      </CardContent>
    </Card>
  );
}

function AvailableIntegrationCard({ provider, description, canConnect, onConnect, connecting }: {
  provider: IntegrationProvider;
  description: string;
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
      <CardContent>
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
      toast.error(error instanceof Error ? error.message : "Unable to start connection");
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
              <ConnectedIntegrationCard provider="meta" integration={metaIntegration} resourceCounts={metaCounts} onManage={() => setManagingProvider("meta")} />
            )}
            {whatsappIntegration && (
              <ConnectedIntegrationCard provider="whatsapp" integration={whatsappIntegration} resourceCounts={whatsappCounts} onManage={() => setManagingProvider("whatsapp")} />
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
              description="Facebook Pages, Instagram accounts, and Meta Ad Accounts."
              canConnect={canConnect}
              connecting={connectingProvider === "meta"}
              onConnect={() => handleConnect("meta")}
            />
          )}
          {!whatsappIntegration && (
            <AvailableIntegrationCard
              provider="whatsapp"
              description="WhatsApp Business Account and phone numbers."
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

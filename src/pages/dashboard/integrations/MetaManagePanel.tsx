import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAllFacebookPages, useAllInstagramAccounts, useAllMetaAdAccounts, type WorkspaceIntegrationRow } from "@/hooks/useIntegrations";
import { checkIntegrationConnectionHealth, disconnectIntegration, refreshIntegrationResources, setResourceActive, type IntegrationResourceHealth } from "@/lib/integrations";
import { presentIntegrationStatus, toneClassName } from "@/lib/integrationStatus";

function ResourceRow({ label, sublabel, active, disabled, onToggle, health }: { label: string; sublabel?: string; active: boolean; disabled: boolean; onToggle: (next: boolean) => void; health?: IntegrationResourceHealth }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <Checkbox checked={active} disabled={disabled} onCheckedChange={(v) => onToggle(v === true)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{label}</p>
        {sublabel && <p className="truncate text-xs text-muted-foreground">{sublabel}</p>}
      </div>
      {health && !health.healthy && (
        <Badge variant="secondary" className="gap-1 text-amber-800">
          <AlertTriangle className="h-3 w-3" /> Issue
        </Badge>
      )}
    </div>
  );
}

export function MetaManagePanel({ workspaceId, integration, canManage, canDisconnect, onDisconnected }: {
  workspaceId: string;
  integration: WorkspaceIntegrationRow;
  canManage: boolean;
  canDisconnect: boolean;
  onDisconnected: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: pages, isLoading: pagesLoading } = useAllFacebookPages(workspaceId);
  const { data: igAccounts, isLoading: igLoading } = useAllInstagramAccounts(workspaceId);
  const { data: adAccounts, isLoading: adLoading } = useAllMetaAdAccounts(workspaceId);

  const [refreshing, setRefreshing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [health, setHealth] = useState<IntegrationResourceHealth[] | null>(null);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["integrations-facebook-pages", workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ["integrations-instagram-accounts", workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ["integrations-meta-ad-accounts", workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ["workspace-integrations", workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ["social-destinations", workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ["meta-facebook-pages-for-ads", workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ["meta-instagram-accounts-for-ads", workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ["meta-ad-accounts", workspaceId] }),
    ]);

  const handleToggle = async (table: "workspace_facebook_pages" | "workspace_instagram_accounts" | "workspace_meta_ad_accounts", id: string, next: boolean) => {
    try {
      await setResourceActive(table, id, next);
      await invalidate();
      toast.success(next ? "Enabled for this workspace" : "Disabled for this workspace");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update this resource");
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const result = await refreshIntegrationResources(workspaceId, "meta");
      await invalidate();
      const { facebookPages, instagramAccounts, adAccounts: adSummary } = result.summary;
      toast.success(`Refreshed: ${facebookPages.new} new Page(s), ${instagramAccounts.new} new Instagram account(s), ${adSummary.new} new ad account(s)`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to refresh resources");
    } finally {
      setRefreshing(false);
    }
  };

  const handleCheck = async () => {
    setChecking(true);
    try {
      const result = await checkIntegrationConnectionHealth(workspaceId, "meta");
      setHealth(result.resources);
      await queryClient.invalidateQueries({ queryKey: ["workspace-integrations", workspaceId] });
      if (result.integration.healthy) {
        toast.success("All connected resources are healthy");
      } else {
        toast.error("Some resources need attention");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to check connection");
    } finally {
      setChecking(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnectIntegration(workspaceId, "meta");
      await invalidate();
      toast.success("Meta disconnected");
      onDisconnected();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to disconnect");
    } finally {
      setDisconnecting(false);
      setConfirmDisconnect(false);
    }
  };

  const status = presentIntegrationStatus(integration.last_health_check_status, integration.status === "connected");
  const healthFor = (id: string) => health?.find((r) => r.id === id);

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          Manage Meta <Badge className={toneClassName(status.tone)}>{status.label}</Badge>
        </SheetTitle>
        <SheetDescription>Choose which Facebook Pages, Instagram accounts, and Meta Ad Accounts StabiFlow uses for this workspace.</SheetDescription>
      </SheetHeader>

      <div className="mt-6 flex gap-2">
        <Button variant="outline" size="sm" onClick={handleCheck} disabled={checking || !canManage}>
          {checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Check connection
        </Button>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing || !canManage}>
          {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh resources
        </Button>
        {canDisconnect && (
          <Button variant="outline" size="sm" className="ml-auto text-destructive" onClick={() => setConfirmDisconnect(true)}>
            <Unplug className="mr-2 h-4 w-4" /> Disconnect
          </Button>
        )}
      </div>

      <Separator className="my-6" />

      <div className="space-y-6 overflow-y-auto pr-1">
        <section>
          <h4 className="mb-2 text-sm font-semibold">Facebook Pages</h4>
          {pagesLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : !pages?.length ? (
            <p className="text-sm text-muted-foreground">No Pages found on this Meta connection.</p>
          ) : (
            <div className="space-y-2">
              {pages.map((p) => (
                <ResourceRow key={p.id} label={p.page_name} active={p.is_active} disabled={!canManage} onToggle={(next) => handleToggle("workspace_facebook_pages", p.id, next)} health={healthFor(p.id)} />
              ))}
            </div>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-sm font-semibold">Instagram accounts</h4>
          <p className="mb-2 text-xs text-muted-foreground">Eligible accounts linked through Facebook.</p>
          {igLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : !igAccounts?.length ? (
            <p className="text-sm text-muted-foreground">No linked Instagram accounts found.</p>
          ) : (
            <div className="space-y-2">
              {igAccounts.map((a) => (
                <ResourceRow key={a.id} label={a.username ? `@${a.username}` : a.ig_business_account_id} active={a.is_active} disabled={!canManage} onToggle={(next) => handleToggle("workspace_instagram_accounts", a.id, next)} health={healthFor(a.id)} />
              ))}
            </div>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-sm font-semibold">Advertising</h4>
          <p className="mb-2 text-xs text-muted-foreground">Meta Ad Accounts.</p>
          {adLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : !adAccounts?.length ? (
            <p className="text-sm text-muted-foreground">No ad accounts found on this Meta connection.</p>
          ) : (
            <div className="space-y-2">
              {adAccounts.map((a) => (
                <ResourceRow key={a.id} label={a.name || a.ad_account_id} sublabel={a.currency ?? undefined} active={a.is_active} disabled={!canManage} onToggle={(next) => handleToggle("workspace_meta_ad_accounts", a.id, next)} health={healthFor(a.id)} />
              ))}
            </div>
          )}
        </section>
      </div>

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Meta?</AlertDialogTitle>
            <AlertDialogDescription>
              StabiFlow will lose access to publish or manage ads through this connection. Past content, campaigns, and analytics are kept - nothing is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDisconnect} disabled={disconnecting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {disconnecting ? "Disconnecting..." : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

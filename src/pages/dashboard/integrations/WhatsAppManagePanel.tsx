import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusPill } from "@/components/ui/status-pill";
import { Separator } from "@/components/ui/separator";
import { SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAllWhatsAppNumbers, type WorkspaceIntegrationRow } from "@/hooks/useIntegrations";
import { checkIntegrationConnectionHealth, disconnectIntegration, refreshIntegrationResources, setResourceActive, type IntegrationResourceHealth } from "@/lib/integrations";
import { presentIntegrationStatus, statusPillTone } from "@/lib/integrationStatus";

export function WhatsAppManagePanel({ workspaceId, integration, canManage, canDisconnect, onDisconnected, chrome = "sheet" }: {
  workspaceId: string;
  integration: WorkspaceIntegrationRow;
  canManage: boolean;
  canDisconnect: boolean;
  onDisconnected: () => void;
  // "sheet" (default) renders the Radix Sheet header primitives - only
  // valid inside a <Sheet>. "page" renders a plain heading so the exact
  // same panel can be embedded in the WhatsApp > Settings page without a
  // dialog wrapper. All management logic is identical either way.
  chrome?: "sheet" | "page";
}) {
  const queryClient = useQueryClient();
  const { data: numbers, isLoading, isError } = useAllWhatsAppNumbers(workspaceId);

  const [refreshing, setRefreshing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [health, setHealth] = useState<IntegrationResourceHealth[] | null>(null);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["integrations-whatsapp-numbers", workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ["workspace-integrations", workspaceId] }),
    ]);

  const handleToggle = async (id: string, next: boolean) => {
    try {
      await setResourceActive("workspace_whatsapp_numbers", id, next);
      await invalidate();
      toast.success(next ? "Enabled for this workspace" : "Disabled for this workspace");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update this number");
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const result = await refreshIntegrationResources(workspaceId, "whatsapp");
      await invalidate();
      toast.success(`Refreshed: ${result.summary.whatsappNumbers.new} new number(s) found`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to refresh numbers");
    } finally {
      setRefreshing(false);
    }
  };

  const handleCheck = async () => {
    setChecking(true);
    try {
      const result = await checkIntegrationConnectionHealth(workspaceId, "whatsapp");
      setHealth(result.resources);
      await queryClient.invalidateQueries({ queryKey: ["workspace-integrations", workspaceId] });
      if (result.integration.healthy) {
        toast.success("All connected numbers are healthy");
      } else {
        toast.error("Some numbers need attention");
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
      await disconnectIntegration(workspaceId, "whatsapp");
      await invalidate();
      toast.success("WhatsApp disconnected");
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
      {chrome === "sheet" ? (
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            Manage WhatsApp <StatusPill tone={statusPillTone(status.tone)}>{status.label}</StatusPill>
          </SheetTitle>
          <SheetDescription>Choose which WhatsApp Business phone number(s) StabiFlow uses for this workspace.</SheetDescription>
        </SheetHeader>
      ) : (
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-title-section text-foreground">
            Manage WhatsApp <StatusPill tone={statusPillTone(status.tone)}>{status.label}</StatusPill>
          </h2>
          <p className="text-sm text-muted-foreground">Choose which WhatsApp Business phone number(s) StabiFlow uses for this workspace.</p>
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={handleCheck} disabled={checking || !canManage}>
          {checking ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Check connection
        </Button>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing || !canManage}>
          {refreshing ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          Refresh numbers
        </Button>
        {canDisconnect && (
          <Button variant="outline" size="sm" className="ml-auto text-destructive" onClick={() => setConfirmDisconnect(true)}>
            <Unplug aria-hidden="true" /> Disconnect
          </Button>
        )}
      </div>

      <Separator className="my-6" />

      <section>
        <h3 className="mb-2 text-title-card text-foreground">Phone numbers</h3>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : isError ? (
          <p role="alert" className="flex items-center gap-2 text-sm text-destructive-strong">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> Couldn't load phone numbers. Reload to try again.
          </p>
        ) : !numbers?.length ? (
          <p className="text-sm text-muted-foreground">No WhatsApp Business phone numbers found on this connection.</p>
        ) : (
          <div className="space-y-2">
            {numbers.map((n) => {
              const h = healthFor(n.id);
              return (
                <div key={n.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                  <Checkbox checked={n.is_active} disabled={!canManage} onCheckedChange={(v) => handleToggle(n.id, v === true)} aria-label={`Use ${n.verified_name || n.display_phone_number || n.phone_number_id}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{n.verified_name || n.display_phone_number || n.phone_number_id}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {n.display_phone_number}
                      {n.quality_rating ? ` · quality: ${n.quality_rating}` : ""}
                    </p>
                  </div>
                  {h && !h.healthy && (
                    <StatusPill tone="warning" title={h.message}>Issue</StatusPill>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>
              StabiFlow will lose access to this WhatsApp Business connection. Past conversations and analytics are kept - nothing is deleted.
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

import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { roleHasPermission } from "@/lib/permissions";
import { workspaceRoleRank } from "@/lib/workspaceRoles";
import { useWorkspaceSlaSettings, updateWorkspaceSlaSettings } from "@/hooks/useWorkspaceSlaSettings";
import { useWorkspaceAiSettings, updateWorkspaceAiSettings } from "@/hooks/useWorkspaceAiSettings";
import { useInboxAiUsage, updateInboxAiCap } from "@/hooks/useInboxAiUsage";
import { AI_MEDIA_SUPPORTED_FORMATS } from "@/lib/multimodalMedia";
import { INBOX_AI_CAP_MAX, INBOX_AI_CAP_MIN, usagePercent } from "@/lib/inboxAiBudget";
import { useLastWhatsAppWebhookEvent } from "@/hooks/useWhatsAppStatus";
import { repairWhatsAppWebhookSubscription } from "@/lib/integrations";
import { presentIntegrationStatus, presentWebhookSubscription, toneClassName } from "@/lib/integrationStatus";
import { WhatsAppManagePanel } from "@/pages/dashboard/integrations/WhatsAppManagePanel";
import { BusinessHoursCard } from "@/pages/dashboard/whatsapp/BusinessHoursCard";
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
  const canManageWorkspace = workspaceRoleRank(role) >= workspaceRoleRank("admin");

  const queryClient = useQueryClient();
  const { data: sla } = useWorkspaceSlaSettings(workspaceId);
  const [slaMinutes, setSlaMinutes] = useState<string>("");
  const [savingSla, setSavingSla] = useState(false);
  useEffect(() => { if (sla && slaMinutes === "") setSlaMinutes(String(sla.handoff_sla_minutes)); }, [sla, slaMinutes]);

  const saveSla = async (patch: { handoff_sla_minutes?: number; handoff_sla_enabled?: boolean }) => {
    setSavingSla(true);
    try {
      await updateWorkspaceSlaSettings(workspaceId, patch);
      await queryClient.invalidateQueries({ queryKey: ["workspace-sla-settings", workspaceId] });
      toast.success("SLA settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to save SLA settings");
    } finally {
      setSavingSla(false);
    }
  };
  const canManageBilling = roleHasPermission(role, "manage_billing");
  const { data: inboxAiUsage } = useInboxAiUsage(workspaceId);
  const [capInput, setCapInput] = useState<string>("");
  const [savingCap, setSavingCap] = useState(false);
  useEffect(() => {
    if (inboxAiUsage && capInput === "") setCapInput(inboxAiUsage.overrideCap != null ? String(inboxAiUsage.overrideCap) : "");
  }, [inboxAiUsage, capInput]);
  const saveCap = async (raw: string) => {
    const trimmed = raw.trim();
    let cap: number | null = null;
    if (trimmed !== "") {
      const n = Math.trunc(Number(trimmed));
      if (!Number.isFinite(n) || n < INBOX_AI_CAP_MIN || n > INBOX_AI_CAP_MAX) {
        toast.error(`Enter a whole number between ${INBOX_AI_CAP_MIN} and ${INBOX_AI_CAP_MAX}, or leave blank for the platform default.`);
        return;
      }
      cap = n;
    }
    setSavingCap(true);
    try {
      await updateInboxAiCap(workspaceId, cap);
      await queryClient.invalidateQueries({ queryKey: ["inbox-ai-usage", workspaceId] });
      toast.success(cap == null ? "Inbox AI limit set to the platform default" : "Inbox AI monthly limit saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to save the Inbox AI limit");
    } finally {
      setSavingCap(false);
    }
  };

  const { data: aiSettings } = useWorkspaceAiSettings(workspaceId);
  const [savingAi, setSavingAi] = useState(false);
  const saveMultimodal = async (enabled: boolean) => {
    setSavingAi(true);
    try {
      await updateWorkspaceAiSettings(workspaceId, { ai_multimodal_enabled: enabled });
      await queryClient.invalidateQueries({ queryKey: ["workspace-ai-settings", workspaceId] });
      toast.success(enabled ? "AI attachment reading enabled" : "AI attachment reading disabled");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to save AI settings");
    } finally {
      setSavingAi(false);
    }
  };
  const saveVoiceTranscription = async (enabled: boolean) => {
    setSavingAi(true);
    try {
      await updateWorkspaceAiSettings(workspaceId, { ai_voice_transcription_enabled: enabled });
      await queryClient.invalidateQueries({ queryKey: ["workspace-ai-settings", workspaceId] });
      toast.success(enabled ? "Voice-note transcription enabled" : "Voice-note transcription disabled");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to save AI settings");
    } finally {
      setSavingAi(false);
    }
  };
  const saveMatchCustomerLanguage = async (enabled: boolean) => {
    setSavingAi(true);
    try {
      await updateWorkspaceAiSettings(workspaceId, { match_customer_language: enabled });
      await queryClient.invalidateQueries({ queryKey: ["workspace-ai-settings", workspaceId] });
      toast.success(enabled ? "Customer-language matching enabled" : "Customer-language matching disabled");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to save AI settings");
    } finally {
      setSavingAi(false);
    }
  };
  const { data: lastEvent } = useLastWhatsAppWebhookEvent(workspaceId);
  const status = presentIntegrationStatus(integration.last_health_check_status, integration.status === "connected");
  const wabaId = numbers.find((n) => n.waba_id)?.waba_id ?? null;

  const webhook = presentWebhookSubscription(integration.webhook_subscription_status, !!lastEvent);
  const [repairing, setRepairing] = useState(false);
  const handleRepair = async () => {
    setRepairing(true);
    try {
      const result = await repairWhatsAppWebhookSubscription(workspaceId);
      await queryClient.invalidateQueries({ queryKey: ["workspace-integrations", workspaceId] });
      if (result.webhookSubscription.status === "subscribed") {
        toast.success("Webhook subscription repaired - inbound messages will now be delivered.");
      } else {
        toast.error(result.webhookSubscription.detail || "Could not confirm the webhook subscription.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to repair the webhook subscription");
    } finally {
      setRepairing(false);
    }
  };

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
            <span className="inline-flex flex-wrap items-center justify-end gap-2">
              <Badge className={toneClassName(webhook.tone)}>{webhook.label}</Badge>
              {integration.webhook_subscription_checked_at && (
                <span className="text-xs text-muted-foreground">checked {relativeTime(integration.webhook_subscription_checked_at)}</span>
              )}
              {canManage && (
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={handleRepair} disabled={repairing}>
                  {repairing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                  {webhook.actionable ? "Subscribe webhook" : "Repair subscription"}
                </Button>
              )}
            </span>
          </Row>
        </CardContent>
      </Card>
      {webhook.actionable && webhook.hint && (
        <p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {webhook.hint}
          {" "}If it stays unsubscribed after repairing, verify in Meta that the WhatsApp Business Account&apos;s callback URL and verify token are set for this app.
        </p>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Human response SLA</CardTitle></CardHeader>
        <CardContent className="space-y-3 pt-0">
          <p className="text-sm text-muted-foreground">
            StabiFlow will flag conversations that are still waiting for a human response after this time - they appear in Needs Attention and get an &ldquo;Overdue&rdquo; badge in the Inbox.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sla?.handoff_sla_enabled ?? true}
                disabled={!canManageWorkspace || savingSla}
                onChange={(e) => saveSla({ handoff_sla_enabled: e.target.checked })}
              />
              SLA tracking enabled
            </label>
            <span className="flex items-center gap-2 text-sm">
              <Input
                type="number"
                min={1}
                max={1440}
                value={slaMinutes}
                disabled={!canManageWorkspace || savingSla || !(sla?.handoff_sla_enabled ?? true)}
                onChange={(e) => setSlaMinutes(e.target.value)}
                className="h-8 w-20"
              />
              minutes
              {canManageWorkspace && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={savingSla || slaMinutes === "" || Number(slaMinutes) === (sla?.handoff_sla_minutes ?? 10)}
                  onClick={() => saveSla({ handoff_sla_minutes: Number(slaMinutes) })}
                >
                  Save
                </Button>
              )}
            </span>
          </div>
          {!canManageWorkspace && <p className="text-xs text-muted-foreground">Only workspace owners and admins can change this.</p>}
        </CardContent>
      </Card>

      <BusinessHoursCard workspaceId={workspaceId} canManage={canManageWorkspace} />

      <Card>
        <CardHeader><CardTitle className="text-base">AI document understanding</CardTitle></CardHeader>
        <CardContent className="space-y-3 pt-0">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={aiSettings?.ai_multimodal_enabled ?? false}
              disabled={!canManageWorkspace || savingAi}
              onChange={(e) => saveMultimodal(e.target.checked)}
            />
            <span>Allow AI to read customer attachments</span>
          </label>
          <p className="text-sm text-muted-foreground">
            When enabled, StabiFlow may send supported customer images and PDFs to the configured AI provider to understand the enquiry and collect intake information. Supported attachments are sent securely to that provider for analysis. Leave this off if you do not want customer attachments shared with the AI provider.
          </p>
          <p className="text-xs text-muted-foreground">
            Images: {AI_MEDIA_SUPPORTED_FORMATS.images.join(", ")} &nbsp;·&nbsp; Documents: {AI_MEDIA_SUPPORTED_FORMATS.documents.join(", ")}
          </p>
          {!canManageWorkspace && <p className="text-xs text-muted-foreground">Only workspace owners and admins can change this.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Voice notes</CardTitle></CardHeader>
        <CardContent className="space-y-3 pt-0">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={aiSettings?.ai_voice_transcription_enabled ?? false}
              disabled={!canManageWorkspace || savingAi}
              onChange={(e) => saveVoiceTranscription(e.target.checked)}
            />
            <span>Transcribe customer voice notes</span>
          </label>
          <p className="text-sm text-muted-foreground">
            When enabled, a customer voice note&apos;s audio is sent to the configured AI provider to produce a text transcript for your team and for Inbox AI. The original audio is always kept privately either way, and staff can always listen to it. Transcripts are automatic and may contain errors.
          </p>
          <p className="text-xs text-muted-foreground">
            Counts towards this workspace&apos;s monthly Inbox AI usage limit.
          </p>
          {!canManageWorkspace && <p className="text-xs text-muted-foreground">Only workspace owners and admins can change this.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Customer language</CardTitle></CardHeader>
        <CardContent className="space-y-3 pt-0">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={aiSettings?.match_customer_language ?? false}
              disabled={!canManageWorkspace || savingAi}
              onChange={(e) => saveMatchCustomerLanguage(e.target.checked)}
            />
            <span>Match the customer&apos;s language</span>
          </label>
          <p className="text-sm text-muted-foreground">
            When enabled, StabiFlow may adapt AI WhatsApp replies to the customer&apos;s language and conversational style while preserving the original meaning, amounts, names, links and business information.
          </p>
          <p className="text-xs text-muted-foreground">
            AI localization may contain language mistakes. The original StabiFlow reply remains the source of truth. Counts towards this workspace&apos;s monthly Inbox AI usage limit.
          </p>
          {!canManageWorkspace && <p className="text-xs text-muted-foreground">Only workspace owners and admins can change this.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Inbox AI monthly usage limit</CardTitle></CardHeader>
        <CardContent className="space-y-3 pt-0">
          <p className="text-sm text-muted-foreground">
            StabiFlow pauses Inbox AI when this workspace reaches its monthly limit. Customer messages continue to arrive and are handed to staff - no automatic reply is sent.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number"
              min={INBOX_AI_CAP_MIN}
              max={INBOX_AI_CAP_MAX}
              placeholder="Platform default"
              value={capInput}
              disabled={!canManageBilling || savingCap}
              onChange={(e) => setCapInput(e.target.value)}
              className="h-8 w-40"
            />
            <span className="text-sm text-muted-foreground">tokens / month</span>
            {canManageBilling && (
              <Button
                size="sm"
                variant="outline"
                disabled={savingCap || capInput === (inboxAiUsage?.overrideCap != null ? String(inboxAiUsage.overrideCap) : "")}
                onClick={() => saveCap(capInput)}
              >
                Save
              </Button>
            )}
          </div>
          {inboxAiUsage?.overrideCap == null && (
            <p className="text-xs text-muted-foreground">Currently using the platform default limit. Enter a number to set a workspace-specific limit; clear it to go back to the default.</p>
          )}
          {inboxAiUsage?.overrideCap != null && inboxAiUsage.usedThisMonth != null && (
            <p className="text-xs text-muted-foreground">
              Used this month: {inboxAiUsage.usedThisMonth.toLocaleString()} / {inboxAiUsage.overrideCap.toLocaleString()} tokens
              {" "}({usagePercent(inboxAiUsage.usedThisMonth, inboxAiUsage.overrideCap)}%)
            </p>
          )}
          {!canManageBilling && <p className="text-xs text-muted-foreground">Only the workspace owner can change AI usage limits.</p>}
        </CardContent>
      </Card>

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

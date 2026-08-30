import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, CalendarClock, CheckCircle2, Loader2, PauseCircle, PlayCircle, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { MediaPreview } from "@/components/content/MediaPreview";
import { EmptyState } from "@/components/EmptyState";
import { CampaignLifecycleBadge } from "@/components/campaigns/CampaignLifecycleBadge";
import { CampaignActionsMenu } from "@/components/campaigns/CampaignActionsMenu";
import { CampaignJourney } from "@/components/campaigns/CampaignJourney";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceCurrency } from "@/hooks/useWorkspaceCurrency";
import { useWorkspaceTimezone } from "@/hooks/useWorkspaceTimezone";
import { useAllWhatsAppNumbers } from "@/hooks/useIntegrations";
import { useAdCampaign, useCampaignActivity } from "@/hooks/useAdCampaign";
import { useAdCampaignMetrics } from "@/hooks/useAdCampaignMetrics";
import { useSingleCampaignPerformance } from "@/hooks/useAnalytics";
import { DEFAULT_ATTRIBUTION_MODEL, computeRoas, formatMoneyByCurrency, formatRoas } from "@/lib/analytics";
import { getObjectiveOption, DESTINATION_TYPE_LABELS, type DestinationType } from "@/lib/adObjectives";
import { formatMoney } from "@/lib/adMoney";
import { localDateString } from "@/lib/analyticsDate";
import {
  deriveCampaignPresentation, isEditableCampaign, isUnpublishedCampaign, type ReadinessSnapshot,
} from "@/lib/campaignLifecycle";
import { formatScheduleStart, isScheduledStartTooCloseOrPast } from "@/lib/campaignSchedule";
import { campaignEditorPath, presentReadinessIssue, readinessActionLabel } from "@/lib/readinessIssuePresentation";
import {
  CampaignPublishNotReadyError, checkCampaignReadiness, newPublishIdempotencyKey, pauseCampaign, publishCampaign, refreshCampaignMetrics,
  resumeCampaign, syncCampaignReviewStatus, type ReadinessIssue,
} from "@/lib/adCampaigns";

// All-time window for this widget - matches the Phase G conversions card's
// original semantics (every real touchpoint this campaign ever produced,
// not scoped to a date picker Campaign Detail doesn't have). Uses the SAME
// get_campaign_performance read model /analytics uses (just filtered to
// one campaign_id client-side) so the two surfaces can never disagree.
const ALL_TIME_RANGE = { from: new Date(0), to: new Date(Date.now() + 86_400_000) };

function calendarDateLabel(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : localDateString(d, timeZone);
}

export function CampaignDetail({ campaignId }: { campaignId: string }) {
  const { hasPermission, currentWorkspaceId } = useAuth();
  const workspaceCurrency = useWorkspaceCurrency(currentWorkspaceId);
  const workspaceTimezone = useWorkspaceTimezone(currentWorkspaceId);
  const queryClient = useQueryClient();
  const { data: campaign, isLoading } = useAdCampaign(campaignId);
  const { data: activity } = useCampaignActivity(campaignId);
  const { data: metrics, isLoading: metricsLoading } = useAdCampaignMetrics(campaignId);
  const { data: performance } = useSingleCampaignPerformance(currentWorkspaceId, campaignId, ALL_TIME_RANGE, DEFAULT_ATTRIBUTION_MODEL);
  const { data: whatsappNumbers } = useAllWhatsAppNumbers(currentWorkspaceId);
  const canSeeRevenue = hasPermission("revenue.view");

  const [issues, setIssues] = useState<ReadinessIssue[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [refreshingMetrics, setRefreshingMetrics] = useState(false);
  const idempotencyKeyRef = useRef<string>(newPublishIdempotencyKey());

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["ad-campaign", campaignId] });
    queryClient.invalidateQueries({ queryKey: ["ad-campaigns"] });
    queryClient.invalidateQueries({ queryKey: ["ad-campaign-activity", campaignId] });
  };

  const unpublished = campaign ? isUnpublishedCampaign(campaign) : false;

  const runReadinessCheck = async () => {
    setChecking(true);
    try {
      const result = await checkCampaignReadiness(campaignId);
      setIssues(result.issues);
      // Reconcile stored review status with the ACTUAL result, exactly as
      // the builder does - promotes draft -> 'ready' when it passes,
      // demotes a stale 'ready' -> 'draft' when it doesn't. This is what
      // keeps the list/detail badge honest.
      if (campaign && isUnpublishedCampaign(campaign)) {
        try {
          await syncCampaignReviewStatus(campaignId, result.ready);
          queryClient.invalidateQueries({ queryKey: ["ad-campaign", campaignId] });
          queryClient.invalidateQueries({ queryKey: ["ad-campaigns"] });
        } catch {
          // best-effort: a caller without campaign.edit can still see readiness
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to check readiness");
    } finally {
      setChecking(false);
    }
  };

  // Run a readiness check for any campaign that hasn't been published yet -
  // its result drives both the lifecycle badge (Needs attention vs Ready
  // to publish) and the actionable issue list below.
  useEffect(() => {
    if (campaign && isUnpublishedCampaign(campaign) && issues === null) {
      runReadinessCheck();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign?.id, campaign?.status]);

  const handlePublish = async () => {
    setPublishing(true);
    try {
      const result = await publishCampaign(campaignId, idempotencyKeyRef.current);
      if (result.ok) toast.success("Campaign published to Meta");
      else if (result.outcome === "partial") toast.warning("Campaign partially published - some objects were created at Meta before it failed. Check Activity for details.");
      else toast.error(result.error || "Publish failed");
      await invalidate();
    } catch (error) {
      if (error instanceof CampaignPublishNotReadyError) {
        // Server rejected on readiness - show the actionable issues in the
        // same panel (each with its Edit action), not just a toast. The
        // server also persisted last_readiness_check, so refresh the list.
        setIssues(error.issues);
        await invalidate();
        toast.error("This campaign isn't ready to publish yet - see the checklist below.");
      } else {
        toast.error(error instanceof Error ? error.message : "Unable to publish this campaign right now.");
      }
    } finally {
      setPublishing(false);
    }
  };

  const handlePauseResume = async () => {
    if (!campaign) return;
    setPausing(true);
    try {
      if (campaign.status === "active") {
        await pauseCampaign(campaignId);
        toast.success("Campaign paused");
      } else {
        await resumeCampaign(campaignId);
        toast.success("Campaign resumed");
      }
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update campaign status");
    } finally {
      setPausing(false);
    }
  };

  const handleRefreshMetrics = async () => {
    setRefreshingMetrics(true);
    try {
      await refreshCampaignMetrics(campaignId);
      await queryClient.invalidateQueries({ queryKey: ["ad-campaign-metrics", campaignId] });
      toast.success("Metrics refreshed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to refresh metrics");
    } finally {
      setRefreshingMetrics(false);
    }
  };

  if (isLoading) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  if (!campaign) return <EmptyState icon={AlertTriangle} title="Campaign not found" description="It may have been deleted, or you may not have access to it." />;

  const objectiveOption = getObjectiveOption(campaign.objective);
  const budget = campaign.budget_type === "daily" ? campaign.daily_budget_minor_units : campaign.lifetime_budget_minor_units;
  const creative = campaign.ad_creatives as unknown as {
    primary_text: string; headline: string | null; description: string | null; cta: string; destination_url: string | null;
    whatsapp_number_id: string | null; media_asset_id: string;
    content_media_assets: { storage_path: string; title: string } | null;
  } | null;
  const totalSpend = (metrics || []).reduce((sum, m) => sum + m.spend_minor_units, 0);

  const liveReadiness = issues !== null ? { ready: issues.every((i) => i.severity !== "error"), issues } : null;
  const presentation = deriveCampaignPresentation({
    status: campaign.status,
    externalCampaignId: campaign.external_campaign_id,
    liveReadiness,
    lastReadinessCheck: (campaign.last_readiness_check as ReadinessSnapshot | null) ?? null,
  });

  const audience = (campaign.audience || {}) as { age_min?: number; age_max?: number; genders?: string; geo_countries?: string[] };
  const audienceSummary = [
    audience.age_min != null && audience.age_max != null ? `Ages ${audience.age_min}-${audience.age_max}` : null,
    audience.genders ? (audience.genders === "all" ? "All genders" : audience.genders) : null,
    audience.geo_countries?.length ? audience.geo_countries.join(", ") : null,
  ].filter(Boolean).join(" · ") || "-";

  const whatsappNumber = creative?.whatsapp_number_id
    ? (whatsappNumbers || []).find((n) => n.id === creative.whatsapp_number_id) ?? null
    : null;
  const destinationDetail =
    campaign.destination_type === "website" ? creative?.destination_url || null
    : campaign.destination_type === "whatsapp" ? (whatsappNumber?.display_phone_number || "WhatsApp number") : null;

  const startsNow = !campaign.start_at;
  const startTooCloseOrPast = isScheduledStartTooCloseOrPast(campaign.start_at, new Date());
  const scheduleStartLabel = formatScheduleStart(campaign.start_at, workspaceTimezone);
  const scheduleEndLabel = campaign.end_at ? formatScheduleStart(campaign.end_at, workspaceTimezone) : null;
  const canEditSchedule = isEditableCampaign(campaign) && hasPermission("campaign.edit");

  const editLink = (field?: string) => campaignEditorPath(campaignId, "Budget & Schedule", field);

  // Actionable readiness rows: reuse presentReadinessIssue + the builder's
  // own field-focus keys, turned into a deep link into the editor.
  const readinessRows = (issues || []).map((issue) => {
    const p = presentReadinessIssue(issue);
    return {
      key: `${issue.code}:${issue.message}`,
      issue,
      message: p.message,
      severity: issue.severity,
      actionLabel: readinessActionLabel(p),
      href: p.step ? campaignEditorPath(campaignId, p.step, p.field) : null,
    };
  });
  const hasBlockingIssues = readinessRows.some((r) => r.severity === "error");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CampaignLifecycleBadge state={presentation} />
            <h1 className="text-2xl font-semibold tracking-tight">{campaign.name}</h1>
          </div>
          <p className="text-sm text-muted-foreground">{objectiveOption?.label || campaign.objective} · {campaign.workspace_meta_ad_accounts?.name || campaign.ad_account_id}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(campaign.status === "active" || campaign.status === "paused") && hasPermission("campaign.pause") && (
            <Button variant="outline" onClick={handlePauseResume} disabled={pausing}>
              {campaign.status === "active" ? <PauseCircle className="mr-2 h-4 w-4" /> : <PlayCircle className="mr-2 h-4 w-4" />}
              {campaign.status === "active" ? "Pause" : "Resume"}
            </Button>
          )}
          <CampaignActionsMenu campaign={campaign} />
        </div>
      </div>

      {/* Needs-attention panel: shown for an unpublished campaign whose
          readiness has any issue. Every fixable issue links straight into
          the editor at the right step/field. */}
      {unpublished && liveReadiness && readinessRows.length > 0 && (
        <Card className={hasBlockingIssues ? "border-amber-300 dark:border-amber-800" : ""}>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">
              {hasBlockingIssues ? "This campaign needs attention before it can be published" : "Ready to publish - with warnings"}
            </CardTitle>
            <Button variant="outline" size="sm" onClick={runReadinessCheck} disabled={checking}>
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Re-check"}
            </Button>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {readinessRows.map((row) => (
                <li key={row.key} className={`flex flex-wrap items-start justify-between gap-2 rounded-md border p-2 text-sm ${row.severity === "error" ? "border-red-200 text-red-700 dark:border-red-900 dark:text-red-400" : "border-amber-200 text-amber-700 dark:border-amber-900 dark:text-amber-400"}`}>
                  <span className="flex items-start gap-2">
                    {row.severity === "error" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                    {row.message}
                  </span>
                  {row.href && row.actionLabel && canEditSchedule && (
                    <Button asChild type="button" variant="outline" size="sm">
                      <Link to={row.href}>{row.actionLabel}</Link>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Publish panel: only once readiness actually passes (presentation
          === ready_to_publish) or a prior publish failed. Never gated on a
          stale stored 'ready'. */}
      {unpublished && (presentation === "ready_to_publish" || campaign.status === "failed") && hasPermission("campaign.publish") && (
        <Card>
          <CardHeader><CardTitle>{campaign.status === "failed" ? "Publish failed - retry" : "Ready to publish"}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {campaign.last_publish_error && (
              <p className="text-sm text-red-700 dark:text-red-400">
                Last error: {(campaign.last_publish_error as { message?: string })?.message || "Unknown error"}
              </p>
            )}
            {liveReadiness?.ready && issues?.length === 0 && (
              <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" /> Ready to publish.</p>
            )}
            <Button onClick={handlePublish} disabled={!liveReadiness?.ready || publishing} className="w-full">
              {publishing ? "Publishing..." : "Publish to Meta"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="creative">Creative</TabsTrigger>
          <TabsTrigger value="journey">Journey</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardContent className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
              <div><p className="text-xs text-muted-foreground">Campaign name</p><p className="text-sm font-medium">{campaign.name}</p></div>
              <div><p className="text-xs text-muted-foreground">Objective</p><p className="text-sm font-medium">{objectiveOption?.label || campaign.objective}</p></div>
              <div><p className="text-xs text-muted-foreground">Status</p><p className="text-sm font-medium"><CampaignLifecycleBadge state={presentation} /></p></div>
              <div><p className="text-xs text-muted-foreground">Ad account</p><p className="text-sm font-medium">{campaign.workspace_meta_ad_accounts?.name || campaign.workspace_meta_ad_accounts?.ad_account_id || campaign.ad_account_id}</p></div>
              <div><p className="text-xs text-muted-foreground">Budget</p><p className="text-sm font-medium">{formatMoney(budget, campaign.currency)} ({campaign.budget_type})</p></div>
              <div>
                <p className="text-xs text-muted-foreground">Schedule</p>
                <p className="text-sm font-medium">
                  {startsNow ? "Start now (immediate)" : scheduleStartLabel}
                  {scheduleEndLabel ? ` → ${scheduleEndLabel}` : startsNow ? "" : " → ongoing"}
                </p>
                {!startsNow && <p className="text-xs text-muted-foreground">{workspaceTimezone}</p>}
                {startTooCloseOrPast && (
                  <span className="mt-1 inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                    <CalendarClock className="h-3.5 w-3.5" /> Scheduled start time is too close or has passed.
                    {canEditSchedule && <Link to={editLink("startAt")} className="underline underline-offset-2">Edit schedule</Link>}
                  </span>
                )}
              </div>
              <div><p className="text-xs text-muted-foreground">Audience</p><p className="text-sm font-medium">{audienceSummary}</p></div>
              <div><p className="text-xs text-muted-foreground">Destination</p><p className="text-sm font-medium">{DESTINATION_TYPE_LABELS[campaign.destination_type as DestinationType] || campaign.destination_type}{destinationDetail ? ` — ${destinationDetail}` : ""}</p></div>
              <div><p className="text-xs text-muted-foreground">Facebook Page</p><p className="text-sm font-medium">{campaign.workspace_facebook_pages?.page_name || "-"}</p></div>
              <div><p className="text-xs text-muted-foreground">Instagram</p><p className="text-sm font-medium">{campaign.workspace_instagram_accounts?.username ? `@${campaign.workspace_instagram_accounts.username}` : "-"}</p></div>
              {campaign.destination_type === "whatsapp" && (
                <div><p className="text-xs text-muted-foreground">WhatsApp destination</p><p className="text-sm font-medium">{whatsappNumber?.display_phone_number || whatsappNumber?.verified_name || "-"}</p></div>
              )}
              <div><p className="text-xs text-muted-foreground">Meta campaign ID</p><p className="text-sm font-medium">{campaign.external_campaign_id || "Not published yet"}</p></div>
              <div><p className="text-xs text-muted-foreground">Created</p><p className="text-sm font-medium">{calendarDateLabel(campaign.created_at, workspaceTimezone)}</p></div>
              <div><p className="text-xs text-muted-foreground">Last updated</p><p className="text-sm font-medium">{calendarDateLabel(campaign.updated_at, workspaceTimezone)}</p></div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="creative" className="mt-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">The media and copy this campaign will run.</p>
            {isEditableCampaign(campaign) && hasPermission("campaign.edit") && (
              <Button asChild variant="outline" size="sm">
                <Link to={campaignEditorPath(campaignId, "Creative")}>Edit creative</Link>
              </Button>
            )}
          </div>
          {creative ? (
            <Card>
              <CardContent className="flex flex-col gap-4 p-6 sm:flex-row">
                {creative.content_media_assets && (
                  <div className="shrink-0">
                    <MediaPreview storagePath={creative.content_media_assets.storage_path} alt={creative.content_media_assets.title} className="h-32 w-32 rounded-md object-cover" />
                    <p className="mt-1 max-w-32 truncate text-xs text-muted-foreground" title={creative.content_media_assets.title}>{creative.content_media_assets.title}</p>
                  </div>
                )}
                <div className="min-w-0 flex-1 space-y-2 text-sm">
                  {creative.headline && <p className="font-medium">{creative.headline}</p>}
                  <p><span className="text-muted-foreground">Primary text:</span> {creative.primary_text}</p>
                  {creative.description && <p><span className="text-muted-foreground">Description:</span> {creative.description}</p>}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Badge variant="outline">{creative.cta || "No CTA"}</Badge>
                    {campaign.destination_type === "website" && creative.destination_url && (
                      <span className="truncate text-xs text-muted-foreground">{creative.destination_url}</span>
                    )}
                    {campaign.destination_type === "whatsapp" && (
                      <span className="text-xs text-muted-foreground">WhatsApp: {whatsappNumber?.display_phone_number || "number not resolved"}</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <EmptyState icon={AlertTriangle} title="No creative" description="This campaign has no creative selected yet." />
          )}
        </TabsContent>

        <TabsContent value="journey" className="mt-4">
          <CampaignJourney campaignId={campaignId} />
        </TabsContent>

        <TabsContent value="performance" className="mt-4 space-y-3">
          {performance && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Conversions (all time, last-touch attribution)</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-4 gap-3 text-center text-sm">
                <div><p className="text-lg font-semibold">{performance.conversations}</p><p className="text-xs text-muted-foreground">Conversations</p></div>
                <div><p className="text-lg font-semibold">{performance.leads}</p><p className="text-xs text-muted-foreground">Leads</p></div>
                <div><p className="text-lg font-semibold">{performance.opportunities}</p><p className="text-xs text-muted-foreground">Opportunities</p></div>
                <div><p className="text-lg font-semibold">{performance.customers}</p><p className="text-xs text-muted-foreground">Customers</p></div>
              </CardContent>
              {canSeeRevenue && (
                <CardContent className="grid grid-cols-2 gap-3 border-t pt-3 text-center text-sm">
                  <div><p className="text-lg font-semibold">{formatMoneyByCurrency(performance.revenue, workspaceCurrency)}</p><p className="text-xs text-muted-foreground">Attributed revenue</p></div>
                  <div><p className="text-lg font-semibold">{formatRoas(computeRoas(performance.spend_minor, performance.currency, performance.revenue))}</p><p className="text-xs text-muted-foreground">ROAS</p></div>
                </CardContent>
              )}
            </Card>
          )}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Meta insights, synced automatically every 30 minutes while active.</p>
            {hasPermission("campaign.metrics.view") && campaign.external_campaign_id && (
              <Button variant="outline" size="sm" onClick={handleRefreshMetrics} disabled={refreshingMetrics}>
                <RefreshCw className={`mr-2 h-4 w-4 ${refreshingMetrics ? "animate-spin" : ""}`} /> Refresh
              </Button>
            )}
          </div>
          {metricsLoading ? (
            <div className="h-32 animate-pulse rounded-lg bg-muted" />
          ) : !metrics?.length ? (
            <EmptyState icon={BarChart3} title="No campaign data available yet" description="Performance data will appear after Meta begins delivering your ads." />
          ) : (
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="p-3">Date</th><th className="p-3">Spend</th><th className="p-3">Impressions</th><th className="p-3">Reach</th><th className="p-3">Clicks</th><th className="p-3">CTR</th><th className="p-3">CPC</th><th className="p-3">Results</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.map((m) => (
                      <tr key={m.id} className="border-b last:border-0">
                        <td className="p-3">{m.date_start}</td>
                        <td className="p-3">{formatMoney(m.spend_minor_units, m.currency)}</td>
                        <td className="p-3">{m.impressions.toLocaleString()}</td>
                        <td className="p-3">{m.reach.toLocaleString()}</td>
                        <td className="p-3">{m.clicks.toLocaleString()}</td>
                        <td className="p-3">{m.ctr != null ? `${m.ctr.toFixed(2)}%` : "-"}</td>
                        <td className="p-3">{formatMoney(m.cpc_minor_units, m.currency)}</td>
                        <td className="p-3">{m.results ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-medium">
                      <td className="p-3">Total</td>
                      <td className="p-3">{formatMoney(totalSpend, metrics[0]?.currency || campaign.currency)}</td>
                      <td colSpan={6} />
                    </tr>
                  </tfoot>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          {!activity?.length ? (
            <EmptyState icon={AlertTriangle} title="No activity yet" description="Actions taken on this campaign will appear here." />
          ) : (
            <ul className="space-y-2">
              {activity.map((a) => (
                <li key={a.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                  <span>{a.action.replace(/_/g, " ")}</span>
                  <span className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

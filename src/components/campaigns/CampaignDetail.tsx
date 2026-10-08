import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, CalendarClock, CheckCircle2, History, Loader2, PauseCircle, PlayCircle, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Metric } from "@/components/ui/metric";
import { StatusPill } from "@/components/ui/status-pill";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MediaPreview } from "@/components/content/MediaPreview";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

export function CampaignDetail({ campaignId }: { campaignId: string }) {
  const { hasPermission, currentWorkspaceId } = useAuth();
  const workspaceCurrency = useWorkspaceCurrency(currentWorkspaceId);
  const workspaceTimezone = useWorkspaceTimezone(currentWorkspaceId);
  const queryClient = useQueryClient();
  const { data: campaign, isLoading, isError, refetch } = useAdCampaign(campaignId);
  const activityQuery = useCampaignActivity(campaignId);
  const activity = activityQuery.data;
  const metricsQuery = useAdCampaignMetrics(campaignId);
  const { data: metrics, isLoading: metricsLoading } = metricsQuery;
  const { data: performance, isError: performanceError } = useSingleCampaignPerformance(currentWorkspaceId, campaignId, ALL_TIME_RANGE, DEFAULT_ATTRIBUTION_MODEL);
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

  if (isLoading) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading campaign">
        <div className="h-12 w-72 max-w-full animate-pulse rounded-lg bg-muted" />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }
  // A failed fetch is not "not found" - the campaign may well exist.
  if (isError) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Couldn't load this campaign"
        description="Something went wrong fetching it. Nothing has changed at Meta - try again."
        action={<Button variant="outline" onClick={() => void refetch()}>Try again</Button>}
        className="rounded-xl border border-border bg-card"
      />
    );
  }
  if (!campaign) return <EmptyState icon={AlertTriangle} title="Campaign not found" description="It may have been deleted, or you may not have access to it." className="rounded-xl border border-border bg-card" />;

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
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="min-w-0 break-words text-title-page text-foreground">{campaign.name}</h1>
            <CampaignLifecycleBadge state={presentation} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{objectiveOption?.label || campaign.objective} · {campaign.workspace_meta_ad_accounts?.name || campaign.ad_account_id}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(campaign.status === "active" || campaign.status === "paused") && hasPermission("campaign.pause") && (
            <Button variant="outline" onClick={handlePauseResume} disabled={pausing}>
              {campaign.status === "active" ? <PauseCircle aria-hidden="true" /> : <PlayCircle aria-hidden="true" />}
              {campaign.status === "active" ? "Pause" : "Resume"}
            </Button>
          )}
          <CampaignActionsMenu campaign={campaign} />
        </div>
      </header>

      {/* Needs-attention panel: shown for an unpublished campaign whose
          readiness has any issue. Every fixable issue links straight into
          the editor at the right step/field. */}
      {unpublished && liveReadiness && readinessRows.length > 0 && (
        <section
          aria-label="Publishing checklist"
          className={cn("rounded-xl border bg-card p-4 sm:p-5", hasBlockingIssues ? "border-warning/40" : "border-border")}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="text-title-section text-foreground">
              {hasBlockingIssues ? "This campaign needs attention before it can be published" : "Ready to publish - with warnings"}
            </h2>
            <Button variant="outline" size="sm" onClick={runReadinessCheck} disabled={checking}>
              {checking ? <><Loader2 className="animate-spin" aria-hidden="true" /> Checking</> : "Re-check"}
            </Button>
          </div>
          <ul className="mt-3 space-y-2">
            {readinessRows.map((row) => (
              <li
                key={row.key}
                className={cn(
                  "flex flex-wrap items-start justify-between gap-2 rounded-lg px-3 py-2 text-sm",
                  row.severity === "error" ? "bg-destructive-soft text-destructive-strong" : "bg-warning-soft text-warning",
                )}
              >
                <span className="flex min-w-0 items-start gap-2">
                  {row.severity === "error" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-label="Blocking" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-label="Warning" />}
                  {row.message}
                </span>
                {row.href && row.actionLabel && canEditSchedule && (
                  <Button asChild type="button" variant="outline" size="sm" className="bg-card">
                    <Link to={row.href}>{row.actionLabel}</Link>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Publish panel: only once readiness actually passes (presentation
          === ready_to_publish) or a prior publish failed. Never gated on a
          stale stored 'ready'. */}
      {unpublished && (presentation === "ready_to_publish" || campaign.status === "failed") && hasPermission("campaign.publish") && (
        <section aria-label="Publish" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="min-w-0 space-y-1">
            <h2 className="text-title-section text-foreground">{campaign.status === "failed" ? "Publish failed - retry" : "Ready to publish"}</h2>
            {campaign.last_publish_error && (
              <p className="text-sm text-destructive-strong">
                Last error: {(campaign.last_publish_error as { message?: string })?.message || "Unknown error"}
              </p>
            )}
            {liveReadiness?.ready && issues?.length === 0 && (
              <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Every check passed. Publishing sends this campaign to Meta.</p>
            )}
          </div>
          <Button onClick={handlePublish} disabled={!liveReadiness?.ready || publishing} className="shrink-0">
            {publishing ? "Publishing..." : "Publish to Meta"}
          </Button>
        </section>
      )}

      <Tabs defaultValue="overview">
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="creative">Creative</TabsTrigger>
          <TabsTrigger value="journey">Journey</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <dl className="grid gap-x-6 gap-y-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
            <Field label="Objective">{objectiveOption?.label || campaign.objective}</Field>
            <Field label="Status"><CampaignLifecycleBadge state={presentation} /></Field>
            <Field label="Ad account">{campaign.workspace_meta_ad_accounts?.name || campaign.workspace_meta_ad_accounts?.ad_account_id || campaign.ad_account_id}</Field>
            <Field label="Budget">{formatMoney(budget, campaign.currency)} <span className="font-normal text-muted-foreground">({campaign.budget_type})</span></Field>
            <Field label="Schedule">
              {startsNow ? "Start now (immediate)" : scheduleStartLabel}
              {scheduleEndLabel ? ` → ${scheduleEndLabel}` : startsNow ? "" : " → ongoing"}
              {!startsNow && <span className="block text-xs font-normal text-muted-foreground">{workspaceTimezone}</span>}
              {startTooCloseOrPast && (
                <span className="mt-1 flex flex-wrap items-center gap-1 text-xs font-normal text-warning">
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> Scheduled start time is too close or has passed.
                  {canEditSchedule && <Link to={editLink("startAt")} className="font-medium underline underline-offset-2">Edit schedule</Link>}
                </span>
              )}
            </Field>
            <Field label="Audience">{audienceSummary}</Field>
            <Field label="Destination">{DESTINATION_TYPE_LABELS[campaign.destination_type as DestinationType] || campaign.destination_type}{destinationDetail ? ` — ${destinationDetail}` : ""}</Field>
            <Field label="Facebook Page">{campaign.workspace_facebook_pages?.page_name || "-"}</Field>
            <Field label="Instagram">{campaign.workspace_instagram_accounts?.username ? `@${campaign.workspace_instagram_accounts.username}` : "-"}</Field>
            {campaign.destination_type === "whatsapp" && (
              <Field label="WhatsApp destination">{whatsappNumber?.display_phone_number || whatsappNumber?.verified_name || "-"}</Field>
            )}
            <Field label="Meta campaign ID">{campaign.external_campaign_id || "Not published yet"}</Field>
            <Field label="Created">{calendarDateLabel(campaign.created_at, workspaceTimezone)}</Field>
            <Field label="Last updated">{calendarDateLabel(campaign.updated_at, workspaceTimezone)}</Field>
          </dl>
        </TabsContent>

        <TabsContent value="creative" className="mt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">The media and copy this campaign will run.</p>
            {isEditableCampaign(campaign) && hasPermission("campaign.edit") && (
              <Button asChild variant="outline" size="sm">
                <Link to={campaignEditorPath(campaignId, "Creative")}>Edit creative</Link>
              </Button>
            )}
          </div>
          {creative ? (
            <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:p-5">
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
                    <StatusPill tone="neutral" dot={false}>{creative.cta || "No CTA"}</StatusPill>
                    {campaign.destination_type === "website" && creative.destination_url && (
                      <span className="truncate text-xs text-muted-foreground">{creative.destination_url}</span>
                    )}
                    {campaign.destination_type === "whatsapp" && (
                      <span className="text-xs text-muted-foreground">WhatsApp: {whatsappNumber?.display_phone_number || "number not resolved"}</span>
                    )}
                  </div>
                </div>
            </div>
          ) : (
            <EmptyState icon={AlertTriangle} title="No creative" description="This campaign has no creative selected yet." className="rounded-xl border border-border bg-card" />
          )}
        </TabsContent>

        <TabsContent value="journey" className="mt-4">
          <CampaignJourney campaignId={campaignId} />
        </TabsContent>

        <TabsContent value="performance" className="mt-4 space-y-4">
          <section aria-labelledby="conversions-heading" className="space-y-2">
            <h2 id="conversions-heading" className="text-label text-muted-foreground">Conversions · all time, last-touch attribution</h2>
            {performanceError ? (
              <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">Couldn't load conversions for this campaign right now.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {([
                  ["Conversations", performance?.conversations],
                  ["Leads", performance?.leads],
                  ["Opportunities", performance?.opportunities],
                  ["Customers", performance?.customers],
                ] as const).map(([label, n]) => (
                  <Metric key={label} label={label} state={n == null ? { kind: "no_data", note: "Not available yet" } : n ? { kind: "value", value: String(n) } : { kind: "zero", note: "None attributed yet" }} />
                ))}
                {canSeeRevenue && performance && (
                  <>
                    <Metric label="Attributed revenue" state={{ kind: "value", value: formatMoneyByCurrency(performance.revenue, workspaceCurrency) }} />
                    <Metric label="ROAS" state={{ kind: "value", value: formatRoas(computeRoas(performance.spend_minor, performance.currency, performance.revenue)) }} />
                  </>
                )}
              </div>
            )}
          </section>

          <section aria-labelledby="insights-heading" className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 id="insights-heading" className="text-label text-muted-foreground">Meta insights</h2>
                <p className="text-xs text-muted-foreground">Synced automatically every 30 minutes while active.</p>
              </div>
              {hasPermission("campaign.metrics.view") && campaign.external_campaign_id && (
                <Button variant="outline" size="sm" onClick={handleRefreshMetrics} disabled={refreshingMetrics}>
                  <RefreshCw className={cn(refreshingMetrics && "animate-spin")} aria-hidden="true" /> Refresh
                </Button>
              )}
            </div>
            {metricsLoading ? (
              <div className="h-32 animate-pulse rounded-xl bg-muted" />
            ) : metricsQuery.isError ? (
              <EmptyState
                icon={AlertTriangle}
                title="Couldn't load Meta insights"
                description="Your campaign data is safe - this is only a display problem. Try again."
                action={<Button variant="outline" onClick={() => void metricsQuery.refetch()}>Try again</Button>}
                className="rounded-xl border border-border bg-card"
              />
            ) : !metrics?.length ? (
              <EmptyState
                icon={BarChart3}
                title={campaign.external_campaign_id ? "No campaign data available yet" : "No data until it's published"}
                description={campaign.external_campaign_id ? "Performance data will appear after Meta begins delivering your ads." : "Meta reports spend, reach and clicks once this campaign is published and delivering."}
                className="rounded-xl border border-border bg-card"
              />
            ) : (
              <div className="relative overflow-x-auto rounded-xl border border-border bg-card">
                <table className="w-full min-w-[40rem] text-sm tabular-nums">
                  <thead className="border-b border-border bg-background/60 text-left text-overline uppercase text-muted-foreground">
                    <tr>
                      {["Date", "Spend", "Impressions", "Reach", "Clicks", "CTR", "CPC", "Results"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {metrics.map((m) => (
                      <tr key={m.id}>
                        <th scope="row" className="px-3 py-2.5 text-left font-normal">{m.date_start}</th>
                        <td className="px-3 py-2.5">{formatMoney(m.spend_minor_units, m.currency)}</td>
                        <td className="px-3 py-2.5">{m.impressions.toLocaleString()}</td>
                        <td className="px-3 py-2.5">{m.reach.toLocaleString()}</td>
                        <td className="px-3 py-2.5">{m.clicks.toLocaleString()}</td>
                        <td className="px-3 py-2.5">{m.ctr != null ? `${m.ctr.toFixed(2)}%` : "-"}</td>
                        <td className="px-3 py-2.5">{formatMoney(m.cpc_minor_units, m.currency)}</td>
                        <td className="px-3 py-2.5">{m.results ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-border">
                    <tr className="font-medium">
                      <th scope="row" className="px-3 py-2.5 text-left">Total</th>
                      <td className="px-3 py-2.5">{formatMoney(totalSpend, metrics[0]?.currency || campaign.currency)}</td>
                      <td colSpan={6} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          {activityQuery.isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Couldn't load activity"
              description="Something went wrong fetching this campaign's history. Try again."
              action={<Button variant="outline" onClick={() => void activityQuery.refetch()}>Try again</Button>}
              className="rounded-xl border border-border bg-card"
            />
          ) : !activity?.length ? (
            <EmptyState icon={History} title="No activity yet" description="Actions taken on this campaign will appear here." className="rounded-xl border border-border bg-card" />
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {activity.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-4 py-3 text-sm">
                  <span className="first-letter:uppercase">{a.action.replace(/_/g, " ")}</span>
                  <time dateTime={a.created_at} className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</time>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

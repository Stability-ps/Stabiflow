import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, CheckCircle2, Loader2, PauseCircle, PlayCircle, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { MediaPreview } from "@/components/content/MediaPreview";
import { EmptyState } from "@/components/EmptyState";
import { CampaignStatusBadge } from "@/components/campaigns/CampaignStatusBadge";
import { useAuth } from "@/hooks/useAuth";
import { useAdCampaign, useCampaignActivity } from "@/hooks/useAdCampaign";
import { useAdCampaignMetrics } from "@/hooks/useAdCampaignMetrics";
import { useSingleCampaignPerformance } from "@/hooks/useAnalytics";
import { DEFAULT_ATTRIBUTION_MODEL, computeRoas, formatMoneyByCurrency, formatRoas } from "@/lib/analytics";
import { getObjectiveOption, DESTINATION_TYPE_LABELS, type DestinationType } from "@/lib/adObjectives";
import { formatMoney } from "@/lib/adMoney";
import {
  checkCampaignReadiness, newPublishIdempotencyKey, pauseCampaign, publishCampaign, refreshCampaignMetrics,
  resumeCampaign, type ReadinessIssue,
} from "@/lib/adCampaigns";

// All-time window for this widget - matches the Phase G conversions card's
// original semantics (every real touchpoint this campaign ever produced,
// not scoped to a date picker Campaign Detail doesn't have). Uses the SAME
// get_campaign_performance read model /analytics uses (just filtered to
// one campaign_id client-side) so the two surfaces can never disagree.
const ALL_TIME_RANGE = { from: new Date(0), to: new Date(Date.now() + 86_400_000) };

export function CampaignDetail({ campaignId }: { campaignId: string }) {
  const { hasPermission, currentWorkspaceId } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: campaign, isLoading } = useAdCampaign(campaignId);
  const { data: activity } = useCampaignActivity(campaignId);
  const { data: metrics, isLoading: metricsLoading } = useAdCampaignMetrics(campaignId);
  const { data: performance } = useSingleCampaignPerformance(currentWorkspaceId, campaignId, ALL_TIME_RANGE, DEFAULT_ATTRIBUTION_MODEL);
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

  const runReadinessCheck = async () => {
    setChecking(true);
    try {
      const result = await checkCampaignReadiness(campaignId);
      setIssues(result.issues);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to check readiness");
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (campaign && (campaign.status === "ready" || campaign.status === "failed") && issues === null) {
      runReadinessCheck();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign?.status]);

  const handlePublish = async () => {
    setPublishing(true);
    try {
      const result = await publishCampaign(campaignId, idempotencyKeyRef.current);
      if (result.ok) toast.success("Campaign published to Meta");
      else if (result.outcome === "partial") toast.warning("Campaign partially published - some objects were created at Meta before it failed. Check Activity for details.");
      else toast.error(result.error || "Publish failed");
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Publish failed");
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
    primary_text: string; headline: string | null; description: string | null; cta: string; destination_url: string | null; media_asset_id: string;
    content_media_assets: { storage_path: string; title: string } | null;
  } | null;
  const totalSpend = (metrics || []).reduce((sum, m) => sum + m.spend_minor_units, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CampaignStatusBadge status={campaign.status} />
            <h1 className="text-2xl font-semibold tracking-tight">{campaign.name}</h1>
          </div>
          <p className="text-sm text-muted-foreground">{objectiveOption?.label || campaign.objective} · {campaign.workspace_meta_ad_accounts?.name || campaign.ad_account_id}</p>
        </div>
        <div className="flex gap-2">
          {campaign.status === "draft" && hasPermission("campaign.edit") && (
            <Button variant="outline" onClick={() => navigate(`/campaigns/${campaignId}/edit`)}>Continue editing</Button>
          )}
          {(campaign.status === "active" || campaign.status === "paused") && hasPermission("campaign.pause") && (
            <Button variant="outline" onClick={handlePauseResume} disabled={pausing}>
              {campaign.status === "active" ? <PauseCircle className="mr-2 h-4 w-4" /> : <PlayCircle className="mr-2 h-4 w-4" />}
              {campaign.status === "active" ? "Pause" : "Resume"}
            </Button>
          )}
        </div>
      </div>

      {(campaign.status === "ready" || campaign.status === "failed") && hasPermission("campaign.publish") && (
        <Card>
          <CardHeader><CardTitle>{campaign.status === "failed" ? "Publish failed - retry" : "Ready to publish"}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {campaign.last_publish_error && (
              <p className="text-sm text-red-700 dark:text-red-400">
                Last error: {(campaign.last_publish_error as { message?: string })?.message || "Unknown error"}
              </p>
            )}
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Readiness check</p>
              <Button variant="outline" size="sm" onClick={runReadinessCheck} disabled={checking}>
                {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Re-check"}
              </Button>
            </div>
            {issues && issues.length === 0 && <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" /> Ready to publish.</p>}
            {issues && issues.length > 0 && (
              <ul className="space-y-1">
                {issues.map((issue, i) => (
                  <li key={i} className={`flex items-start gap-2 text-sm ${issue.severity === "error" ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
                    {issue.severity === "error" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                    {issue.message}
                  </li>
                ))}
              </ul>
            )}
            <Button onClick={handlePublish} disabled={!issues || issues.some((i) => i.severity === "error") || publishing} className="w-full">
              {publishing ? "Publishing..." : "Publish to Meta"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="creative">Creative</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
              <div><p className="text-xs text-muted-foreground">Budget</p><p className="text-sm font-medium">{formatMoney(budget, campaign.currency)} ({campaign.budget_type})</p></div>
              <div><p className="text-xs text-muted-foreground">Schedule</p><p className="text-sm font-medium">{new Date(campaign.start_at).toLocaleDateString()}{campaign.end_at ? ` - ${new Date(campaign.end_at).toLocaleDateString()}` : " - ongoing"}</p></div>
              <div><p className="text-xs text-muted-foreground">Destination</p><p className="text-sm font-medium">{DESTINATION_TYPE_LABELS[campaign.destination_type as DestinationType] || campaign.destination_type}</p></div>
              <div><p className="text-xs text-muted-foreground">Facebook Page</p><p className="text-sm font-medium">{campaign.workspace_facebook_pages?.page_name || "-"}</p></div>
              <div><p className="text-xs text-muted-foreground">Instagram</p><p className="text-sm font-medium">{campaign.workspace_instagram_accounts?.username ? `@${campaign.workspace_instagram_accounts.username}` : "-"}</p></div>
              <div><p className="text-xs text-muted-foreground">Meta campaign ID</p><p className="text-sm font-medium">{campaign.external_campaign_id || "Not published yet"}</p></div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="creative" className="mt-4">
          {creative ? (
            <Card>
              <CardContent className="flex gap-4 p-6">
                {creative.content_media_assets && (
                  <MediaPreview storagePath={creative.content_media_assets.storage_path} alt={creative.content_media_assets.title} className="h-24 w-24 shrink-0 rounded-md" />
                )}
                <div className="min-w-0 flex-1 space-y-2">
                  {creative.headline && <p className="font-medium">{creative.headline}</p>}
                  <p className="text-sm">{creative.primary_text}</p>
                  {creative.description && <p className="text-sm text-muted-foreground">{creative.description}</p>}
                  <div className="flex items-center gap-2 pt-2">
                    <Badge variant="outline">{creative.cta}</Badge>
                    {creative.destination_url && <span className="truncate text-xs text-muted-foreground">{creative.destination_url}</span>}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <EmptyState icon={AlertTriangle} title="No creative" description="This campaign has no creative selected yet." />
          )}
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
                  <div><p className="text-lg font-semibold">{formatMoneyByCurrency(performance.revenue, "—")}</p><p className="text-xs text-muted-foreground">Attributed revenue</p></div>
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

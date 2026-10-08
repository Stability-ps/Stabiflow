import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Megaphone, Plug, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Metric } from "@/components/ui/metric";
import { EmptyState } from "@/components/EmptyState";
import { CampaignLifecycleBadge } from "@/components/campaigns/CampaignLifecycleBadge";
import { deriveCampaignPresentation, type CampaignPresentationState, type ReadinessSnapshot } from "@/lib/campaignLifecycle";
import { formatScheduleSummary } from "@/lib/campaignSchedule";
import { getObjectiveOption } from "@/lib/adObjectives";
import { formatMoney } from "@/lib/adMoney";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceTimezone } from "@/hooks/useWorkspaceTimezone";
import { useAdCampaigns } from "@/hooks/useAdCampaigns";
import { useMetaAdAccounts } from "@/hooks/useMetaAccountResources";

// Columns from lg up; below that each campaign is a stacked card row.
const GRID = "lg:grid lg:grid-cols-[minmax(14rem,1.6fr)_9rem_minmax(9rem,0.8fr)_minmax(10rem,1fr)] lg:items-center lg:gap-4";

function NewCampaignButton() {
  return (
    <Button asChild>
      <Link to="/app/campaigns/new"><Plus aria-hidden="true" /> New campaign</Link>
    </Button>
  );
}

export function CampaignsList() {
  const { currentWorkspaceId, hasPermission } = useAuth();
  const workspaceTimezone = useWorkspaceTimezone(currentWorkspaceId);
  const now = new Date();
  const campaignsQuery = useAdCampaigns(currentWorkspaceId);
  const adAccountsQuery = useMetaAdAccounts(currentWorkspaceId);
  const campaigns = campaignsQuery.data;
  const canCreate = hasPermission("campaign.create");

  const rows = useMemo(() => (campaigns ?? []).map((c) => ({
    c,
    presentation: deriveCampaignPresentation({
      status: c.status,
      externalCampaignId: c.external_campaign_id,
      lastReadinessCheck: (c.last_readiness_check as ReadinessSnapshot | null) ?? null,
    }),
  })), [campaigns]);

  const count = (...states: CampaignPresentationState[]) => rows.filter((r) => states.includes(r.presentation)).length;
  const active = count("active");
  const paused = count("paused");
  const attention = count("needs_attention", "failed");
  const unpublished = count("draft", "ready_to_publish");

  if (campaignsQuery.isLoading || adAccountsQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-[1440px] space-y-4" role="status" aria-label="Loading campaigns">
        <div className="h-12 w-64 max-w-full animate-pulse rounded-lg bg-muted" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-[6.5rem] animate-pulse rounded-xl bg-muted" />)}</div>
        <div className="h-[40vh] animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  const loadError = campaignsQuery.isError;
  // An ad-account lookup failure is NOT "not connected" - say we couldn't check.
  const accountsError = adAccountsQuery.isError;
  const noAdAccount = !accountsError && !adAccountsQuery.data?.length;

  const headline = loadError || rows.length === 0
    ? "Meta advertising campaigns, their creatives and what they bring in."
    : [
        active ? `${active} running` : "Nothing running",
        attention ? `${attention} need${attention === 1 ? "s" : ""} attention` : null,
        unpublished ? `${unpublished} not published yet` : null,
      ].filter(Boolean).join(" · ");

  let body;
  if (loadError) {
    body = (
      <EmptyState
        icon={AlertTriangle}
        title="Couldn't load campaigns"
        description="Something went wrong fetching your campaigns. Nothing has changed at Meta - try again."
        action={<Button variant="outline" onClick={() => void campaignsQuery.refetch()}>Try again</Button>}
        className="rounded-xl border border-border bg-card"
      />
    );
  } else if (rows.length === 0 && noAdAccount) {
    body = (
      <EmptyState
        icon={Plug}
        title="Connect a Meta ad account"
        description="Campaigns run through your Meta ad account. Connect it in Integrations, then create your first campaign here."
        action={<Button asChild variant="outline"><Link to="/app/integrations">Go to Integrations</Link></Button>}
        className="rounded-xl border border-border bg-card"
      />
    );
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        icon={Megaphone}
        title="No campaigns yet"
        description="Create a Meta campaign from a creative in your Media Library. Nothing is sent to Meta until you publish it."
        action={canCreate && !accountsError ? <NewCampaignButton /> : undefined}
        className="rounded-xl border border-border bg-card"
      />
    );
  } else {
    body = (
      <>
        <section aria-label="Campaign summary" className="-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4 [&>*]:min-w-[9.5rem] [&>*]:shrink-0 [&>*]:snap-start sm:[&>*]:min-w-0">
          <Metric label="Running" state={{ kind: active ? "value" : "zero", value: String(active), note: "Delivering on Meta" }} />
          <Metric label="Paused" state={{ kind: paused ? "value" : "zero", value: String(paused), note: paused ? "Can be resumed" : "None paused" }} />
          <Metric label="Need attention" state={{ kind: attention ? "value" : "zero", value: String(attention), note: attention ? "Failed or not ready to publish" : "Nothing blocked" }} />
          <Metric label="Not published" state={{ kind: unpublished ? "value" : "zero", value: String(unpublished), note: "Drafts not sent to Meta" }} />
        </section>

        <section aria-label="Campaigns" className="overflow-hidden rounded-xl border border-border bg-card">
          <div aria-hidden="true" className={`hidden border-b border-border bg-background/60 px-4 py-2 text-overline uppercase text-muted-foreground ${GRID}`}>
            <span>Campaign</span><span>Status</span><span>Budget</span><span>Schedule</span>
          </div>
          <ul aria-label="Campaigns" className="divide-y divide-border">
            {rows.map(({ c, presentation }) => {
              const objective = getObjectiveOption(c.objective);
              const budget = c.budget_type === "daily" ? c.daily_budget_minor_units : c.lifetime_budget_minor_units;
              const account = c.workspace_meta_ad_accounts?.name || c.workspace_meta_ad_accounts?.ad_account_id || "Ad account";
              return (
                <li key={c.id}>
                  <Link
                    to={`/app/campaigns/${c.id}`}
                    className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-4 py-3 transition-colors duration-fast hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${GRID}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground" title={c.name}>{c.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{objective?.label || c.objective} · {account}</span>
                    </span>
                    <span className="self-start lg:self-center"><CampaignLifecycleBadge state={presentation} /></span>
                    <span className="col-span-2 mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground lg:contents">
                      <span className="tabular-nums lg:text-sm lg:text-foreground">
                        {formatMoney(budget, c.currency)} <span className="text-muted-foreground">{c.budget_type === "daily" ? "/ day" : "lifetime"}</span>
                      </span>
                      <span aria-hidden="true" className="lg:hidden">·</span>
                      <span className="lg:text-sm">{formatScheduleSummary(c.start_at, workspaceTimezone, now)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title-page text-foreground">Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">{headline}</p>
        </div>
        {canCreate && !loadError && rows.length > 0 && <NewCampaignButton />}
      </header>

      {/* Existing campaigns stay visible when the ad account is gone or can't be checked. */}
      {!loadError && rows.length > 0 && (noAdAccount || accountsError) && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {accountsError
              ? "We couldn't check your Meta ad account connection. Publishing and metrics may not work until it's confirmed."
              : "No Meta ad account is connected. Reconnect it to publish drafts and keep metrics updating."}
          </span>
          {accountsError ? (
            <Button variant="outline" size="sm" onClick={() => void adAccountsQuery.refetch()}>Check again</Button>
          ) : (
            <Button asChild variant="outline" size="sm"><Link to="/app/integrations">Go to Integrations</Link></Button>
          )}
        </div>
      )}

      {body}
    </div>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Route as RouteIcon, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceCurrency } from "@/hooks/useWorkspaceCurrency";
import { useCampaignJourney, useCampaignJourneyStageEntities, type JourneyEntityRow } from "@/hooks/useCampaignJourney";
import { ATTRIBUTION_MODELS, ATTRIBUTION_MODEL_LABELS, DEFAULT_ATTRIBUTION_MODEL, formatMoneyByCurrency, formatRoas, type AttributionModel } from "@/lib/analytics";
import { formatMoney } from "@/lib/adMoney";
import {
  BAND_EXPLANATION, breakdownBy, buildJourneyStages, hasAnyJourneyData, journeyHeadline,
  stageEntityIds, tallyBands, type BreakdownRow, type JourneyStageKey,
} from "@/lib/campaignJourney";

function pct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(value < 10 ? 1 : 0)}%`;
}

function StageColumn({ label, count, costLabel, rateLabel, bands }: {
  label: string;
  count: number;
  costLabel: string | null;
  rateLabel: string | null;
  bands: { direct: number; inferred: number } | null;
}) {
  return (
    <div className="min-w-[104px] flex-1 rounded-lg border p-3 text-center">
      <p className="text-xl font-semibold tabular-nums">{count}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
      {costLabel !== null && <p className="mt-1 text-[11px] text-muted-foreground">{costLabel}</p>}
      {rateLabel !== null && <p className="text-[11px] text-muted-foreground">{rateLabel} of prev.</p>}
      {bands && (bands.direct > 0 || bands.inferred > 0) && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          <span className="text-emerald-700 dark:text-emerald-400">{bands.direct} direct</span>
          {" · "}
          <span className="text-amber-700 dark:text-amber-400">{bands.inferred} inferred</span>
        </p>
      )}
    </div>
  );
}

function BreakdownTable({ title, rows, nameFor, note }: {
  title: string;
  rows: BreakdownRow[];
  nameFor: (id: string) => string | undefined;
  note?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border p-3 text-sm text-muted-foreground">
        No {title.toLowerCase()} data yet — this campaign has not been published, or no attributed touchpoints reference one.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <caption className="sr-only">{title} conversion breakdown</caption>
        <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">{title}</th>
            <th scope="col" className="px-3 py-2 font-medium">Conv.</th>
            <th scope="col" className="px-3 py-2 font-medium">Leads</th>
            <th scope="col" className="px-3 py-2 font-medium">Opps</th>
            <th scope="col" className="px-3 py-2 font-medium">Cust.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-b-0">
              <td className="px-3 py-2 font-medium">{nameFor(r.id) || "—"}</td>
              <td className="px-3 py-2 tabular-nums">{r.conversations}</td>
              <td className="px-3 py-2 tabular-nums">{r.leads}</td>
              <td className="px-3 py-2 tabular-nums">{r.opportunities}</td>
              <td className="px-3 py-2 tabular-nums">{r.customers}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {note && <p className="px-3 py-2 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

const STAGE_LINK: Record<JourneyStageKey, (row: JourneyEntityRow) => { to: string; state?: unknown } | null> = {
  conversations: (r) => ({ to: "/app/whatsapp/inbox", state: { selectedId: r.conversationId ?? r.id } }),
  qualified_leads: (r) => ({ to: "/app/leads", state: { selectedLeadId: r.leadId ?? r.id } }),
  leads: (r) => ({ to: "/app/leads", state: { selectedLeadId: r.leadId ?? r.id } }),
  opportunities: (r) => (r.leadId ? { to: "/app/leads", state: { selectedLeadId: r.leadId } } : null),
  customers: (r) => (r.leadId ? { to: "/app/leads", state: { selectedLeadId: r.leadId, openCustomerId: r.customerId ?? r.id } } : null),
};

function StageEntityList({ workspaceId, stage, entries }: {
  workspaceId: string | null;
  stage: JourneyStageKey;
  entries: { id: string; method: string | null }[];
}) {
  const [shown, setShown] = useState(20);
  const visible = entries.slice(0, shown);
  const { data: rows, isLoading } = useCampaignJourneyStageEntities(workspaceId, stage, visible);

  if (entries.length === 0) {
    return <p className="px-3 py-2 text-sm text-muted-foreground">Nothing at this stage yet.</p>;
  }
  if (isLoading && !rows) {
    return <div className="m-3 h-24 animate-pulse rounded-md bg-muted" />;
  }

  const byId = new Map((rows || []).map((r) => [r.id, r]));

  return (
    <div>
      <ul className="divide-y">
        {visible.map((e) => {
          const row = byId.get(e.id);
          const link = row ? STAGE_LINK[stage](row) : null;
          return (
            <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{row?.primaryLabel ?? "Loading…"}</p>
                {row?.secondaryLabel && <p className="truncate text-xs text-muted-foreground">{row.secondaryLabel}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {row?.statusLabel && <Badge variant="secondary" className="text-[10px]">{row.statusLabel}</Badge>}
                {link ? (
                  <Link
                    to={link.to}
                    state={link.state}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Open <ArrowRight className="h-3 w-3" />
                  </Link>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {entries.length > shown && (
        <button
          type="button"
          onClick={() => setShown((n) => n + 20)}
          className="w-full border-t px-3 py-2 text-xs font-medium text-primary hover:bg-muted/40"
        >
          Show more ({entries.length - shown} of {entries.length} remaining)
        </button>
      )}
    </div>
  );
}

export function CampaignJourney({ campaignId }: { campaignId: string }) {
  const { currentWorkspaceId } = useAuth();
  const workspaceCurrency = useWorkspaceCurrency(currentWorkspaceId);
  const [model, setModel] = useState<AttributionModel>(DEFAULT_ATTRIBUTION_MODEL);

  const journey = useCampaignJourney(currentWorkspaceId, campaignId, model);

  if (!journey.canView) {
    return (
      <EmptyState
        icon={RouteIcon}
        title="Campaign Journey"
        description="You don't have permission to view attribution for this workspace. Ask a workspace owner or admin."
      />
    );
  }

  if (journey.isLoading && !journey.funnel) {
    return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  }

  if (journey.isError) {
    return (
      <EmptyState
        icon={RouteIcon}
        title="Unable to load the journey"
        description="Something went wrong loading this campaign's journey. Try again shortly."
      />
    );
  }

  if (!hasAnyJourneyData(journey.funnel)) {
    return (
      <EmptyState
        icon={RouteIcon}
        title="No campaign attribution yet"
        description="Once this campaign is published and starts driving Click-to-WhatsApp conversations — and those become leads, opportunities and customers — the spend-to-revenue journey will build here automatically."
      />
    );
  }

  const funnel = journey.funnel!;
  const stages = buildJourneyStages(funnel);
  const head = journeyHeadline(funnel);

  const bandFor = (stage: JourneyStageKey) => tallyBands(stageEntityIds(journey.drillRows, stage).map((e) => ({ attribution_method: e.method })));

  const adSetBreakdown = breakdownBy(journey.drillRows, "ad_set_id");
  const adBreakdown = breakdownBy(journey.drillRows, "ad_id");
  const creativeBreakdown = breakdownBy(journey.drillRows, "creative_id");

  const money = (minor: number | null) => (minor === null ? "—" : formatMoney(minor, funnel.currency));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <RouteIcon className="h-4 w-4" /> Campaign Journey
          </h2>
          <p className="text-sm text-muted-foreground">Spend → conversations → leads → opportunities → customers → revenue. All-time.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Attribution model
          <Select value={model} onValueChange={(v) => setModel(v as AttributionModel)}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ATTRIBUTION_MODELS.map((m) => (
                <SelectItem key={m} value={m}>{ATTRIBUTION_MODEL_LABELS[m]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      {/* Headline KPIs */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
          <div><p className="text-lg font-semibold tabular-nums">{formatMoney(funnel.spend_minor, funnel.currency)}</p><p className="text-xs text-muted-foreground">Spend</p></div>
          <div><p className="text-lg font-semibold tabular-nums">{funnel.clicks}</p><p className="text-xs text-muted-foreground">Clicks{head.costPerClickMinor !== null ? ` · ${money(head.costPerClickMinor)}/click` : ""}</p></div>
          <div><p className="text-lg font-semibold tabular-nums">{funnel.customers}</p><p className="text-xs text-muted-foreground">Customers</p></div>
          {journey.canSeeRevenue ? (
            <>
              <div><p className="text-lg font-semibold tabular-nums">{formatMoneyByCurrency(funnel.revenue, workspaceCurrency)}</p><p className="text-xs text-muted-foreground">Attributed revenue</p></div>
              <div><p className="text-lg font-semibold tabular-nums">{money(head.cacMinor)}</p><p className="text-xs text-muted-foreground">CAC</p></div>
              <div><p className="text-lg font-semibold tabular-nums">{formatRoas(head.roas)}</p><p className="text-xs text-muted-foreground">ROAS</p></div>
            </>
          ) : (
            <div className="col-span-2 flex items-center text-xs text-muted-foreground lg:col-span-3">
              <TrendingUp className="mr-1.5 h-3.5 w-3.5" /> Revenue &amp; ROAS require the revenue permission.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Funnel */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Funnel ({ATTRIBUTION_MODEL_LABELS[model]})</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-stretch gap-2">
            <StageColumn label="Clicks" count={funnel.clicks} costLabel={head.costPerClickMinor !== null ? `${money(head.costPerClickMinor)}/click` : null} rateLabel={null} bands={null} />
            {stages.map((s) => (
              <StageColumn
                key={s.key}
                label={s.label}
                count={s.count}
                costLabel={s.costPerMinor !== null ? `${money(s.costPerMinor)}/${s.label.toLowerCase()}` : null}
                rateLabel={pct(s.rateFromPrevious)}
                bands={s.key === "qualified_leads" ? null : bandFor(s.key)}
              />
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            A dash (—) means there is not enough data to compute that rate or cost yet; 0 is a real measured zero. {BAND_EXPLANATION}
          </p>
        </CardContent>
      </Card>

      {/* Structural drill-down: ad set / ad / creative (conversion counts only) */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">By ad set, ad &amp; creative</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <details>
            <summary className="cursor-pointer text-sm font-medium">Ad sets ({adSetBreakdown.length})</summary>
            <div className="mt-2"><BreakdownTable title="Ad set" rows={adSetBreakdown} nameFor={(id) => journey.names.adSet.get(id)} note="Spend is synced at campaign level only — ad-set / ad / creative rows show attributed conversions, not cost." /></div>
          </details>
          <details>
            <summary className="cursor-pointer text-sm font-medium">Ads ({adBreakdown.length})</summary>
            <div className="mt-2"><BreakdownTable title="Ad" rows={adBreakdown} nameFor={(id) => journey.names.ad.get(id)} /></div>
          </details>
          <details>
            <summary className="cursor-pointer text-sm font-medium">Creatives ({creativeBreakdown.length})</summary>
            <div className="mt-2"><BreakdownTable title="Creative" rows={creativeBreakdown} nameFor={(id) => journey.names.creative.get(id)} /></div>
          </details>
        </CardContent>
      </Card>

      {/* Entity drill-down: real conversations / leads / opportunities / customers */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Open the records behind the numbers</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(["conversations", "leads", "opportunities", "customers"] as JourneyStageKey[]).map((stage) => {
            const entries = stageEntityIds(journey.drillRows, stage);
            return (
              <details key={stage}>
                <summary className="cursor-pointer text-sm font-medium capitalize">{stage} ({entries.length})</summary>
                <div className="mt-2 rounded-md border">
                  <StageEntityList workspaceId={currentWorkspaceId} stage={stage} entries={entries} />
                </div>
              </details>
            );
          })}
        </CardContent>
      </Card>

      {journey.capped && (
        <p className="text-[11px] text-muted-foreground">
          This campaign has a large number of touchpoints; the breakdown above is based on the most recent {journey.drillRows.length}. Full totals are shown in the funnel.
        </p>
      )}
    </div>
  );
}

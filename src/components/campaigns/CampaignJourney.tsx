import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Route as RouteIcon, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceCurrency } from "@/hooks/useWorkspaceCurrency";
import {
  JOURNEY_ENTITY_PAGE_SIZE, useCampaignJourney, useCampaignJourneyNames, useCampaignJourneyStageEntities,
  type JourneyEntityRow, type JourneyStageParam,
} from "@/hooks/useCampaignJourney";
import { ATTRIBUTION_MODELS, ATTRIBUTION_MODEL_LABELS, DEFAULT_ATTRIBUTION_MODEL, formatMoneyByCurrency, formatRoas, type AttributionModel } from "@/lib/analytics";
import { formatMoney } from "@/lib/adMoney";
import {
  BAND_EXPLANATION, BREAKDOWN_NOTE, breakdownRemainder, buildJourneyStages, hasAnyJourneyData, journeyHeadline,
  toFunnel, type CampaignJourneyRow, type JourneyBreakdownRow, type JourneyStageKey,
} from "@/lib/campaignJourney";

const NOT_SYNCED = "Not synced yet";

function pct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(value < 10 ? 1 : 0)}%`;
}

const STAGE_PARAM: Record<JourneyStageKey, JourneyStageParam> = {
  conversations: "conversation",
  leads: "lead",
  qualified_leads: "qualified_lead",
  opportunities: "opportunity",
  customers: "customer",
};

function StageColumn({ label, count, costLabel, rateLabel, previousLabel, bands }: {
  label: string;
  count: number;
  costLabel: string | null;
  rateLabel: string | null;
  previousLabel: string | null;
  bands: { direct: number; inferred: number } | null;
}) {
  return (
    <div className="min-w-[104px] flex-1 rounded-lg border p-3 text-center">
      <p className="text-xl font-semibold tabular-nums">{count}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
      {costLabel !== null && <p className="mt-1 text-[11px] text-muted-foreground">{costLabel}</p>}
      {rateLabel !== null && <p className="text-[11px] text-muted-foreground">{rateLabel}{previousLabel ? ` of ${previousLabel}` : ""}</p>}
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

function BreakdownTable({ title, rows, stageTotals, nameFor }: {
  title: string;
  rows: JourneyBreakdownRow[];
  stageTotals: { conversations: number; leads: number; opportunities: number; customers: number };
  nameFor: (id: string) => string | undefined;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border p-3 text-sm text-muted-foreground">
        No {title.toLowerCase()} has a resolved touchpoint for the credited entities in this campaign yet.
      </div>
    );
  }
  const rem = {
    conversations: breakdownRemainder(stageTotals.conversations, rows, "conversations"),
    leads: breakdownRemainder(stageTotals.leads, rows, "leads"),
    opportunities: breakdownRemainder(stageTotals.opportunities, rows, "opportunities"),
    customers: breakdownRemainder(stageTotals.customers, rows, "customers"),
  };
  const anyRemainder = rem.conversations || rem.leads || rem.opportunities || rem.customers;
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <caption className="sr-only">{title} — model-credited conversion breakdown</caption>
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
          {anyRemainder ? (
            <tr className="border-b last:border-b-0 text-muted-foreground">
              <td className="px-3 py-2 italic">No resolved {title.toLowerCase()}</td>
              <td className="px-3 py-2 tabular-nums">{rem.conversations}</td>
              <td className="px-3 py-2 tabular-nums">{rem.leads}</td>
              <td className="px-3 py-2 tabular-nums">{rem.opportunities}</td>
              <td className="px-3 py-2 tabular-nums">{rem.customers}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

// Every drill-down record links to a REAL object using the exact
// navigation-state keys the Inbox / Leads pages already honour.
function linkFor(stage: JourneyStageParam, r: JourneyEntityRow): { to: string; state?: unknown; label: string } | null {
  switch (stage) {
    case "conversation":
      return { to: "/app/whatsapp/inbox", state: { selectedId: r.conversation_id ?? r.entity_id }, label: "Open conversation" };
    case "lead":
    case "qualified_lead":
      return { to: "/app/leads", state: { selectedLeadId: r.lead_id ?? r.entity_id }, label: "Open lead" };
    case "opportunity":
      return r.lead_id ? { to: "/app/leads", state: { selectedLeadId: r.lead_id }, label: "Open related lead" } : null;
    case "customer":
      // The Leads page has no customer-detail route/state; open the lead
      // it converted from (LeadDetail surfaces the customer + revenue).
      return r.lead_id ? { to: "/app/leads", state: { selectedLeadId: r.lead_id }, label: "Open related lead" } : null;
  }
}

function StageEntityList({ workspaceId, campaignId, stage, model, total, enabled }: {
  workspaceId: string | null;
  campaignId: string;
  stage: JourneyStageParam;
  model: AttributionModel;
  total: number;
  enabled: boolean;
}) {
  const [page, setPage] = useState(0);
  const { data: rows, isLoading, isError, isFetching } = useCampaignJourneyStageEntities(workspaceId, campaignId, stage, model, page, enabled);

  if (total === 0) {
    return <p className="px-3 py-2 text-sm text-muted-foreground">Nothing at this stage yet.</p>;
  }
  if (isLoading && !rows) {
    return <div className="m-3 h-24 animate-pulse rounded-md bg-muted" />;
  }
  if (isError) {
    return <p className="px-3 py-2 text-sm text-muted-foreground">Couldn&apos;t load these records right now.</p>;
  }

  const pageCount = Math.max(1, Math.ceil(total / JOURNEY_ENTITY_PAGE_SIZE));
  const from = page * JOURNEY_ENTITY_PAGE_SIZE + 1;
  const to = Math.min(total, from + (rows?.length ?? 0) - 1);

  return (
    <div>
      <ul className="divide-y">
        {(rows || []).map((r) => {
          const link = linkFor(stage, r);
          return (
            <li key={r.entity_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{r.primary_label}</p>
                {r.secondary_label && <p className="truncate text-xs text-muted-foreground">{r.secondary_label}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {r.status_label && <Badge variant="secondary" className="text-[10px]">{r.status_label}</Badge>}
                {link ? (
                  <Link
                    to={link.to}
                    state={link.state}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {link.label} <ArrowRight className="h-3 w-3" />
                  </Link>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {pageCount > 1 && (
        <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
          <span>{from}–{to} of {total}</span>
          <span className="flex gap-1">
            <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={page === 0 || isFetching} onClick={() => setPage((p) => Math.max(0, p - 1))}>Prev</Button>
            <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={page >= pageCount - 1 || isFetching} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </span>
        </div>
      )}
    </div>
  );
}

export function CampaignJourney({ campaignId }: { campaignId: string }) {
  const { currentWorkspaceId } = useAuth();
  const workspaceCurrency = useWorkspaceCurrency(currentWorkspaceId);
  const [model, setModel] = useState<AttributionModel>(DEFAULT_ATTRIBUTION_MODEL);
  const [openStage, setOpenStage] = useState<JourneyStageKey | null>(null);

  const journey = useCampaignJourney(currentWorkspaceId, campaignId, model);
  const names = useCampaignJourneyNames(currentWorkspaceId, journey.row);

  if (!journey.canView) {
    return (
      <EmptyState
        icon={RouteIcon}
        title="Campaign Journey"
        description="You don't have permission to view attribution for this workspace. Ask a workspace owner or admin."
      />
    );
  }
  if (journey.isLoading && !journey.row) {
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

  const row = journey.row;
  const funnel = row ? toFunnel(row) : null;
  if (!row || !hasAnyJourneyData(funnel)) {
    return (
      <EmptyState
        icon={RouteIcon}
        title="No campaign attribution yet"
        description="Once this campaign is published and starts driving Click-to-WhatsApp conversations — and those become leads, opportunities and customers — the spend-to-revenue journey will build here automatically."
      />
    );
  }

  const stages = buildJourneyStages(row);
  const head = journeyHeadline(row);
  const metricsOk = row.metrics_available;
  const spendCurrency = row.currency;
  const showCurrencyTag = spendCurrency && spendCurrency !== workspaceCurrency;

  const money = (minor: number | null) => (minor === null ? "—" : formatMoney(minor, spendCurrency));
  const stageTotals = { conversations: funnel!.conversations, leads: funnel!.leads, opportunities: funnel!.opportunities, customers: funnel!.customers };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <RouteIcon className="h-4 w-4" /> Campaign Journey
          </h2>
          <p className="text-sm text-muted-foreground">Spend → conversations → leads → qualified → opportunities → customers → revenue. All-time.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Attribution model
          <Select value={model} onValueChange={(v) => { setModel(v as AttributionModel); setOpenStage(null); }}>
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
          <div>
            <p className="text-lg font-semibold tabular-nums">{metricsOk ? formatMoney(funnel!.spend_minor, spendCurrency) : NOT_SYNCED}</p>
            <p className="text-xs text-muted-foreground">Spend{showCurrencyTag && metricsOk ? ` (${spendCurrency})` : ""}</p>
          </div>
          <div>
            <p className="text-lg font-semibold tabular-nums">{metricsOk ? funnel!.clicks : NOT_SYNCED}</p>
            <p className="text-xs text-muted-foreground">Clicks{metricsOk && head.costPerClickMinor !== null ? ` · ${money(head.costPerClickMinor)}/click` : ""}</p>
          </div>
          <div><p className="text-lg font-semibold tabular-nums">{funnel!.customers}</p><p className="text-xs text-muted-foreground">Customers</p></div>
          {journey.canSeeRevenue ? (
            <>
              <div>
                <p className="text-lg font-semibold tabular-nums">{formatMoneyByCurrency(funnel!.revenue, workspaceCurrency)}</p>
                <p className="text-xs text-muted-foreground">Attributed revenue</p>
              </div>
              <div>
                <p className="text-lg font-semibold tabular-nums">{money(head.cacMinor)}</p>
                <p className="text-xs text-muted-foreground">CAC{showCurrencyTag && head.cacMinor !== null ? ` (${spendCurrency})` : ""}</p>
              </div>
              <div><p className="text-lg font-semibold tabular-nums">{formatRoas(head.roas)}</p><p className="text-xs text-muted-foreground">ROAS</p></div>
            </>
          ) : (
            <div className="col-span-2 flex items-center text-xs text-muted-foreground lg:col-span-3">
              <TrendingUp className="mr-1.5 h-3.5 w-3.5" /> Revenue &amp; ROAS require the revenue permission.
            </div>
          )}
        </CardContent>
      </Card>

      {!metricsOk && (
        <p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Meta has not synced ad metrics for this campaign yet — spend, clicks, cost-per-outcome and ROAS are shown as “{NOT_SYNCED}” rather than zero. Conversion counts below are real.
        </p>
      )}

      {/* Funnel */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Funnel ({ATTRIBUTION_MODEL_LABELS[model]})</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-stretch gap-2">
            <StageColumn
              label="Clicks"
              count={metricsOk ? funnel!.clicks : 0}
              costLabel={metricsOk && head.costPerClickMinor !== null ? `${money(head.costPerClickMinor)}/click` : (metricsOk ? null : NOT_SYNCED)}
              rateLabel={null}
              previousLabel={null}
              bands={null}
            />
            {stages.map((s) => (
              <StageColumn
                key={s.key}
                label={s.label}
                count={s.count}
                costLabel={metricsOk ? (s.costPerMinor !== null ? `${money(s.costPerMinor)}/${s.label.toLowerCase()}` : null) : NOT_SYNCED}
                rateLabel={pct(s.rateFromPrevious)}
                previousLabel={s.previousLabel}
                bands={s.bands}
              />
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            A dash (—) means the rate/cost cannot be computed yet; 0 is a real measured zero. {BAND_EXPLANATION}
          </p>
        </CardContent>
      </Card>

      {/* Structural drill-down */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">By ad set, ad &amp; creative (model-credited)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <details>
            <summary className="cursor-pointer text-sm font-medium">Ad sets ({row.adset_breakdown.length})</summary>
            <div className="mt-2"><BreakdownTable title="Ad set" rows={row.adset_breakdown} stageTotals={stageTotals} nameFor={(id) => names.data?.adSet.get(id)} /></div>
          </details>
          <details>
            <summary className="cursor-pointer text-sm font-medium">Ads ({row.ad_breakdown.length})</summary>
            <div className="mt-2"><BreakdownTable title="Ad" rows={row.ad_breakdown} stageTotals={stageTotals} nameFor={(id) => names.data?.ad.get(id)} /></div>
          </details>
          <details>
            <summary className="cursor-pointer text-sm font-medium">Creatives ({row.creative_breakdown.length})</summary>
            <div className="mt-2"><BreakdownTable title="Creative" rows={row.creative_breakdown} stageTotals={stageTotals} nameFor={(id) => names.data?.creative.get(id)} /></div>
          </details>
          <p className="text-[11px] text-muted-foreground">{BREAKDOWN_NOTE}</p>
        </CardContent>
      </Card>

      {/* Entity drill-down — counts come from the SAME RPC as the funnel */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Open the records behind the numbers</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {stages.map((s) => {
            const open = openStage === s.key;
            return (
              <div key={s.key}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenStage(open ? null : s.key)}
                  className="w-full text-left text-sm font-medium"
                >
                  {open ? "▾" : "▸"} {s.label} ({s.count})
                </button>
                {open && (
                  <div className="mt-2 rounded-md border">
                    <StageEntityList
                      workspaceId={currentWorkspaceId}
                      campaignId={campaignId}
                      stage={STAGE_PARAM[s.key]}
                      model={model}
                      total={s.count}
                      enabled
                    />
                  </div>
                )}
              </div>
            );
          })}
          <p className="text-[11px] text-muted-foreground">
            These are exactly the {ATTRIBUTION_MODEL_LABELS[model].toLowerCase()}-credited records counted in the funnel above — opening a stage lists them, most recent first, {JOURNEY_ENTITY_PAGE_SIZE} at a time.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// re-export for tests
export type { CampaignJourneyRow };

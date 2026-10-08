import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, Columns3, List, Search, Settings2, SlidersHorizontal, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Metric } from "@/components/ui/metric";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/hooks/useAuth";
import { roleHasPermission } from "@/lib/permissions";
import { useAllPipelineStages, usePipelines, useLeads } from "@/hooks/useLeads";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { useOpportunityTerminology } from "@/hooks/useOpportunityTerminology";
import {
  DEFAULT_LEAD_FILTERS, filterLeads, filtersActive, leadSources, sortLeads, sourceLabel, summarizeLeads,
  type LeadFilters, type LeadSort, type LeadView,
} from "@/lib/leadsWorkspace";
import { LeadList } from "@/pages/dashboard/leads/LeadList";
import { LeadBoard } from "@/pages/dashboard/leads/LeadBoard";
import { LeadDetail } from "@/pages/dashboard/leads/LeadDetail";
import { PipelineSettings } from "@/pages/dashboard/leads/PipelineSettings";
import { NewLeadDialog } from "@/pages/dashboard/leads/NewLeadDialog";
import { cn } from "@/lib/utils";

/** The list loads the most recent LEADS_LIMIT leads (useLeads); counts say so when the cap is hit. */
const LEADS_LIMIT = 500;

const VIEW_LABEL: Record<LeadView, string> = {
  active: "Open leads", all: "All leads", qualified: "Qualified", follow_up: "Has follow-up", overdue: "Follow-up overdue",
  converted: "Converted", lost: "Lost", archived: "Archived",
};
const SORT_LABEL: Record<LeadSort, string> = { follow_up: "Follow-up soonest", updated: "Recently updated", newest: "Newest", value: "Highest value" };

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground min-[1400px]:contents">
      <span className="min-[1400px]:sr-only">{label}</span>
      {children}
    </label>
  );
}

export default function Leads() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentWorkspaceId, currentMembership, user } = useAuth();
  const role = currentMembership?.role;
  const canView = roleHasPermission(role, "lead.view");
  const canCreate = roleHasPermission(role, "lead.create");
  const canEdit = roleHasPermission(role, "lead.edit");
  const canAssign = roleHasPermission(role, "lead.assign");
  const canViewAttachments = roleHasPermission(role, "lead.attachment.view");
  const canManagePipelines = roleHasPermission(role, "pipeline.manage");
  const canCreateOpportunity = roleHasPermission(role, "opportunity.create");
  const canCloseOpportunity = roleHasPermission(role, "opportunity.close");
  const canRecordRevenue = roleHasPermission(role, "revenue.create");

  const { data: pipelines, isLoading: pipelinesLoading } = usePipelines(canView ? currentWorkspaceId : null);
  const leadsQuery = useLeads(canView ? currentWorkspaceId : null);
  const { data: leads, isLoading: leadsLoading } = leadsQuery;
  const { data: members } = useWorkspaceMembers(canView ? currentWorkspaceId : null);
  const opportunityLabel = useOpportunityTerminology(currentWorkspaceId);
  const pipelineIds = useMemo(() => (pipelines ?? []).map((p) => p.id), [pipelines]);
  const allStages = useAllPipelineStages(canView ? currentWorkspaceId : null, pipelineIds);

  const [view, setView] = useState<"list" | "board">("list");
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [pipelineSettingsOpen, setPipelineSettingsOpen] = useState(false);
  const [filters, setFilters] = useState<LeadFilters>(DEFAULT_LEAD_FILTERS);
  const [sort, setSort] = useState<LeadSort>("follow_up");
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [autoOpenOpportunityForm, setAutoOpenOpportunityForm] = useState(false);
  // One clock per render pass keeps every row's "overdue / today" consistent.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const state = location.state as { selectedLeadId?: string; openOpportunityForm?: boolean } | null;
    if (!state?.selectedLeadId) return;
    setSelectedLeadId(state.selectedLeadId);
    setAutoOpenOpportunityForm(!!state.openOpportunityForm);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  // Every workspace's default pipeline is now created atomically by
  // create_workspace() itself (see 20260906060000_default_pipeline_lifecycle_fix.sql)
  // - a workspace reaching this page with zero pipelines should no longer
  // happen. No frontend call creates one; correctness never depends on
  // visiting this page. (The server-side ensure_default_pipeline action
  // still exists as a defensive/recovery mechanism - see pipelines-actions.)
  useEffect(() => {
    if (!selectedPipelineId && pipelines?.length) {
      setSelectedPipelineId(pipelines.find((p) => p.is_default)?.id || pipelines[0].id);
    }
  }, [pipelines, selectedPipelineId]);

  const allLeads = useMemo(() => leads ?? [], [leads]);
  const stagesById = useMemo(() => new Map(allStages.map((s) => [s.id, s])), [allStages]);
  const memberNames = useMemo(
    () => new Map((members ?? []).map((m) => [m.user_id, (m.profile as { full_name?: string | null } | null)?.full_name || "Unnamed member"])),
    [members],
  );
  const ownerName = (userId: string | null) => (userId ? memberNames.get(userId) ?? "Former member" : null);
  const summary = useMemo(() => summarizeLeads(allLeads, now), [allLeads, now]);
  const sources = useMemo(() => leadSources(allLeads), [allLeads]);
  const openBySource = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of allLeads) if (l.status === "active" && !l.archived_at) counts.set(l.source, (counts.get(l.source) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [allLeads]);
  const visibleLeads = useMemo(
    () => sortLeads(filterLeads(allLeads, filters, { now, userId: user?.id ?? null }), sort),
    [allLeads, filters, now, user?.id, sort],
  );
  // The board shows a pipeline's open leads by stage, so it applies search,
  // owner and source - not the status view or the stage filter.
  const boardLeads = useMemo(
    () => filterLeads(allLeads, { ...filters, view: "active", stage: "any" }, { now, userId: user?.id ?? null }),
    [allLeads, filters, now, user?.id],
  );
  const stageOptions = useMemo(() => {
    const multi = (pipelines ?? []).length > 1;
    const pipelineName = new Map((pipelines ?? []).map((p) => [p.id, p.name]));
    return allStages
      .filter((s) => s.is_active)
      .map((s) => ({ id: s.id, label: multi ? `${pipelineName.get(s.pipeline_id) ?? "Pipeline"} · ${s.name}` : s.name }));
  }, [allStages, pipelines]);

  const set = (patch: Partial<LeadFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const anyFilter = filtersActive(filters);
  const extraFilterCount = [filters.view !== DEFAULT_LEAD_FILTERS.view, filters.stage !== "any", filters.owner !== "any", filters.source !== "any"].filter(Boolean).length;

  if (!currentWorkspaceId || (canView && (pipelinesLoading || leadsLoading))) {
    return (
      <div className="mx-auto w-full max-w-[1440px] space-y-4" role="status" aria-label="Loading leads">
        <div className="h-12 w-64 max-w-full animate-pulse rounded-lg bg-muted" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-[6.5rem] animate-pulse rounded-xl bg-muted" />)}</div>
        <div className="h-[50vh] animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  if (!canView) {
    return <EmptyState icon={Users} title="Leads" description="You don't have permission to view this workspace's leads. Ask a workspace owner or admin." />;
  }

  const followUpDue = summary.overdue + summary.dueToday;
  const headline = leadsQuery.isError
    ? "Your pipeline, follow-ups and owners in one place."
    : [
        followUpDue > 0 ? `${followUpDue} follow-up${followUpDue === 1 ? " is" : "s are"} due or overdue` : null,
        summary.unassigned > 0 ? `${summary.unassigned} lead${summary.unassigned === 1 ? " has" : "s have"} no owner` : null,
      ].filter(Boolean).join(" · ") || (summary.open > 0 ? "Nothing is overdue and every open lead has an owner." : "Your pipeline, follow-ups and owners in one place.");

  const filterControls = (
    <>
      <FilterField label="Show">
        <Select value={filters.view} onValueChange={(v) => set({ view: v as LeadView })}>
          <SelectTrigger className="min-[1400px]:w-auto" aria-label="Show"><SelectValue /></SelectTrigger>
          <SelectContent>{(Object.keys(VIEW_LABEL) as LeadView[]).map((v) => <SelectItem key={v} value={v}>{VIEW_LABEL[v]}</SelectItem>)}</SelectContent>
        </Select>
      </FilterField>
      {view === "list" && (
        <FilterField label="Stage">
          <Select value={filters.stage} onValueChange={(v) => set({ stage: v })}>
            <SelectTrigger className="min-[1400px]:w-auto" aria-label="Stage"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any stage</SelectItem>
              {stageOptions.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </FilterField>
      )}
      <FilterField label="Owner">
        <Select value={filters.owner} onValueChange={(v) => set({ owner: v })}>
          <SelectTrigger className="min-[1400px]:w-auto" aria-label="Owner"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any owner</SelectItem>
            <SelectItem value="me">Assigned to me</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {[...memberNames.entries()].map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterField>
      <FilterField label="Source">
        <Select value={filters.source} onValueChange={(v) => set({ source: v })}>
          <SelectTrigger className="min-[1400px]:w-auto" aria-label="Source"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any source</SelectItem>
            {sources.map((s) => <SelectItem key={s} value={s}>{sourceLabel(s)}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterField>
      {view === "list" && (
        <FilterField label="Sort">
          <Select value={sort} onValueChange={(v) => setSort(v as LeadSort)}>
            <SelectTrigger className="min-[1400px]:w-auto" aria-label="Sort"><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(SORT_LABEL) as LeadSort[]).map((s) => <SelectItem key={s} value={s}>{SORT_LABEL[s]}</SelectItem>)}</SelectContent>
          </Select>
        </FilterField>
      )}
    </>
  );

  const noLeadsAtAll = allLeads.length === 0;
  let emptyList: ReactNode = null;
  if (view === "list" && visibleLeads.length === 0) {
    emptyList = noLeadsAtAll ? (
      <EmptyState
        icon={Users}
        title="No leads yet"
        description="Leads from WhatsApp conversations, your website and manual entries appear here, with their stage, owner and next follow-up."
        action={canCreate ? <NewLeadDialog workspaceId={currentWorkspaceId} onCreated={setSelectedLeadId} /> : undefined}
      />
    ) : filters.owner === "me" && filters.view === "active" && !filters.search.trim() && filters.stage === "any" && filters.source === "any" ? (
      <EmptyState
        icon={Users}
        title="No open leads are assigned to you"
        description="Leads you own will appear here. Unassigned leads may still need an owner."
        action={<div className="flex flex-wrap justify-center gap-2"><Button variant="outline" onClick={() => set({ owner: "unassigned" })}>Show unassigned</Button><Button variant="ghost" onClick={() => setFilters(DEFAULT_LEAD_FILTERS)}>Show all open leads</Button></div>}
      />
    ) : (
      <EmptyState
        icon={Search}
        title="No leads match these filters"
        description="Try a different search or clear the filters to see every open lead."
        action={<Button variant="outline" onClick={() => setFilters(DEFAULT_LEAD_FILTERS)}>Clear filters</Button>}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 md:h-[calc(100dvh-var(--header-height)-3rem)]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title-page text-foreground">Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">{headline}</p>
        </div>
        <div className="flex items-center gap-2">
          {canManagePipelines && (
            <Button variant="outline" onClick={() => setPipelineSettingsOpen(true)}><Settings2 aria-hidden="true" /> Pipelines</Button>
          )}
          {canCreate && <NewLeadDialog workspaceId={currentWorkspaceId} onCreated={setSelectedLeadId} />}
        </div>
      </header>

      {leadsQuery.isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load leads"
          description="Something went wrong fetching your leads. Your data is safe - try again."
          action={<Button variant="outline" onClick={() => void leadsQuery.refetch()}>Try again</Button>}
          className="rounded-xl border border-border bg-card"
        />
      ) : (
        <>
          {/* Phones: one swipeable strip so the lead list starts near the top. */}
          <section aria-label="Lead summary" className="-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-5 [&>*]:min-w-[9.5rem] [&>*]:shrink-0 [&>*]:snap-start sm:[&>*]:min-w-0">
            <Metric label="Open leads" state={{ kind: summary.open ? "value" : "zero", value: String(summary.open), note: "Active, not archived" }} />
            <Metric label="Unassigned" state={{ kind: summary.unassigned ? "value" : "zero", value: String(summary.unassigned), note: summary.unassigned ? "Need an owner" : "Every open lead has an owner" }} />
            <Metric
              label="Follow-up due"
              state={{ kind: followUpDue ? "value" : "zero", value: String(followUpDue), note: followUpDue ? `${summary.overdue} overdue · ${summary.dueToday} today` : "Nothing due today" }}
            />
            <Metric label="Qualified" state={{ kind: summary.qualified ? "value" : "zero", value: String(summary.qualified), note: "Open and qualified" }} />
            <Metric label="Converted" state={{ kind: summary.converted ? "value" : "zero", value: String(summary.converted), note: "Became customers" }} />
          </section>
          {allLeads.length >= LEADS_LIMIT && (
            <p className="-mt-2 text-xs text-muted-foreground">Showing your {LEADS_LIMIT} most recently updated leads - counts cover those leads.</p>
          )}

          <section aria-label="Lead workspace" className="flex min-h-[28rem] flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
            <div className="space-y-2 border-b border-border px-3 py-2.5">
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1 min-[1400px]:max-w-[16rem]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input value={filters.search} onChange={(e) => set({ search: e.target.value })} placeholder="Search leads" aria-label="Search leads" className="pl-9" />
                </div>
                <div className="hidden items-center gap-2 min-[1400px]:flex">{filterControls}</div>
                <Button variant="outline" className="shrink-0 min-[1400px]:hidden" onClick={() => setFilterSheetOpen(true)} aria-label={`Filters${extraFilterCount ? `, ${extraFilterCount} active` : ""}`}>
                  <SlidersHorizontal aria-hidden="true" /><span className="hidden sm:inline">Filters</span>{extraFilterCount ? <span className="rounded-full bg-selected px-1.5 text-xs text-selected-foreground">{extraFilterCount}</span> : null}
                </Button>
                <div role="group" aria-label="Layout" className="ml-auto inline-flex shrink-0 rounded-lg bg-muted p-0.5">
                  {(["list", "board"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={view === v}
                      onClick={() => setView(v)}
                      className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium capitalize transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-3", view === v ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
                    >
                      {v === "list" ? <List className="h-4 w-4 sm:hidden" aria-hidden="true" /> : <Columns3 className="h-4 w-4 sm:hidden" aria-hidden="true" />}
                      <span className="sr-only sm:not-sr-only">{v}</span>
                    </button>
                  ))}
                </div>
              </div>
              {(openBySource.length > 1 || anyFilter) && (
                <div className="-mx-3 flex items-center gap-1.5 overflow-x-auto px-3 pb-0.5 text-xs">
                  {openBySource.length > 1 && <span className="shrink-0 text-muted-foreground">Open leads from</span>}
                  {openBySource.length > 1 && openBySource.map(([source, count]) => (
                    <button
                      key={source}
                      type="button"
                      aria-pressed={filters.source === source}
                      onClick={() => set({ source: filters.source === source ? "any" : source })}
                      className={cn("inline-flex min-h-7 shrink-0 items-center gap-1 rounded-full px-2.5 font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", filters.source === source ? "bg-selected text-selected-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}
                    >
                      {sourceLabel(source)} <span className="tabular-nums">{count}</span>
                    </button>
                  ))}
                  {anyFilter && (
                    <button type="button" onClick={() => setFilters(DEFAULT_LEAD_FILTERS)} className="ml-auto inline-flex min-h-7 shrink-0 items-center gap-1 rounded-full px-2 font-medium text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <X className="h-3 w-3" aria-hidden="true" /> Clear filters
                    </button>
                  )}
                </div>
              )}
            </div>

            {view === "board" ? (
              <LeadBoard
                workspaceId={currentWorkspaceId}
                leads={boardLeads}
                pipelines={pipelines || []}
                selectedPipelineId={selectedPipelineId}
                onSelectPipeline={setSelectedPipelineId}
                onSelectLead={setSelectedLeadId}
                canEdit={canEdit}
                ownerName={ownerName}
                now={now}
              />
            ) : emptyList ? (
              <div className="flex flex-1 items-center justify-center">{emptyList}</div>
            ) : (
              <>
                <p className="sr-only" aria-live="polite">{visibleLeads.length} leads shown</p>
                <LeadList leads={visibleLeads} stagesById={stagesById} ownerName={ownerName} onSelect={setSelectedLeadId} now={now} />
              </>
            )}
          </section>
        </>
      )}

      <Sheet open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <SheetHeader className="text-left">
            <SheetTitle>Filter leads</SheetTitle>
            <SheetDescription>{visibleLeads.length} {visibleLeads.length === 1 ? "lead matches" : "leads match"}</SheetDescription>
          </SheetHeader>
          <div className="mt-4 grid gap-3">{filterControls}</div>
          <div className="mt-5 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setFilters(DEFAULT_LEAD_FILTERS)}>Reset</Button>
            <Button className="flex-1" onClick={() => setFilterSheetOpen(false)}>Show leads</Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={!!selectedLeadId} onOpenChange={(v) => { if (!v) { setSelectedLeadId(null); setAutoOpenOpportunityForm(false); } }}>
        {selectedLeadId && (
          <LeadDetail
            key={selectedLeadId}
            workspaceId={currentWorkspaceId}
            leadId={selectedLeadId}
            canEdit={canEdit}
            canAssign={canAssign}
            canViewAttachments={canViewAttachments}
            canCreateOpportunity={canCreateOpportunity}
            canCloseOpportunity={canCloseOpportunity}
            canRecordRevenue={canRecordRevenue}
            canArchive={roleHasPermission(role, "lead.delete")}
            opportunityLabel={opportunityLabel}
            autoOpenOpportunityForm={autoOpenOpportunityForm}
          />
        )}
      </Sheet>

      <Sheet open={pipelineSettingsOpen} onOpenChange={setPipelineSettingsOpen}>
        {pipelineSettingsOpen && <PipelineSettings workspaceId={currentWorkspaceId} />}
      </Sheet>
    </div>
  );
}

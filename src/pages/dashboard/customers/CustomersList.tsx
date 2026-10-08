import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Contact, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Metric } from "@/components/ui/metric";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/hooks/useAuth";
import { roleHasPermission } from "@/lib/permissions";
import { useCustomersSearch } from "@/hooks/useCustomers";
import { relativeAge } from "@/lib/leadsWorkspace";
import {
  DEFAULT_CUSTOMER_FILTERS, customerFiltersActive, customerStatusLabel, filterCustomers, formatRevenue, ownerNames, sortCustomers, summarizeCustomers,
  type CustomerFilters, type CustomerSort, type CustomerStatusFilter,
} from "@/lib/customersWorkspace";
import { formatMinor, type CustomerListRow } from "@/lib/customer";
import { cn } from "@/lib/utils";

/** customers_search returns at most this many rows (most recently active first). */
export const CUSTOMERS_LIMIT = 100;

const SORT_LABEL: Record<CustomerSort, string> = { updated: "Recently updated", newest: "Newest customers", name: "Name A-Z", open: "Most open work" };
const STATUS_LABEL: Record<CustomerStatusFilter, string> = { any: "Any status", active: "Active", inactive: "Inactive", archived: "Archived" };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground lg:contents">
      <span className="lg:sr-only">{label}</span>
      {children}
    </label>
  );
}

// Columns from lg up; below that each customer is a stacked card row.
const GRID = "lg:grid lg:grid-cols-[minmax(12rem,1.4fr)_minmax(10rem,1fr)_8rem_9.5rem_7.5rem_5.5rem] lg:items-center lg:gap-4";

function CustomerRow({ c, now }: { c: CustomerListRow; now: Date }) {
  const revenue = formatRevenue(c.revenue_by_currency ?? []);
  const closed = c.total_opportunities - c.open_opportunities;
  return (
    <li>
      <Link
        to={`/app/customers/${c.id}`}
        className={`block px-4 py-3 transition-colors duration-fast hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${GRID}`}
      >
        <span className="flex min-w-0 items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium text-foreground" title={c.name}>{c.name}</span>
              {c.status !== "active" && <StatusPill tone="neutral" className="shrink-0">{customerStatusLabel(c.status)}</StatusPill>}
            </span>
            <span className={cn("block truncate text-xs", c.company_name ? "text-muted-foreground" : "text-subtle-foreground lg:text-muted-foreground")} title={c.company_name ?? undefined}>
              {c.company_name || <span className="lg:hidden">{c.phone || c.email || "No contact details"}</span>}
              {!c.company_name && <span className="hidden lg:inline">No company</span>}
            </span>
          </span>
          {/* Phones: the largest currency only, so the name keeps its room. */}
          {revenue && (
            <span className="shrink-0 text-right text-sm font-medium tabular-nums text-foreground lg:hidden" title={revenue}>
              {formatMinor(c.revenue_by_currency[0].currency, c.revenue_by_currency[0].total_minor)}
              {c.revenue_by_currency.length > 1 && <span className="block text-xs font-normal text-muted-foreground">+{c.revenue_by_currency.length - 1} {c.revenue_by_currency.length === 2 ? "currency" : "currencies"}</span>}
            </span>
          )}
        </span>
        {/* Contact (lg only - phones show it in the subtitle when there's no company) */}
        <span className="hidden min-w-0 lg:block">
          {!c.phone && !c.email ? (
            <span className="text-sm text-muted-foreground">No contact details</span>
          ) : (
            <>
              {c.phone && <span className="block truncate text-sm text-foreground">{c.phone}</span>}
              {c.email && <span className="block truncate text-xs text-muted-foreground" title={c.email}>{c.email}</span>}
            </>
          )}
        </span>
        {/* Owner + opportunities + updated: one wrapping line on phones */}
        <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 lg:contents">
          <span className={cn("text-xs lg:truncate lg:text-sm", c.assigned_to_name ? "text-muted-foreground lg:text-foreground" : "font-medium text-warning")}>
            <span className="sr-only">Owner: </span>{c.assigned_to_name ?? "No owner"}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {c.total_opportunities === 0 ? (
              <span className="hidden lg:inline">No opportunities</span>
            ) : c.open_opportunities > 0 ? (
              <><StatusPill tone="info">{c.open_opportunities} open</StatusPill><span className="hidden lg:inline">of {c.total_opportunities}</span></>
            ) : (
              <span>{closed} closed</span>
            )}
          </span>
          <span className="hidden text-right text-sm font-medium tabular-nums text-foreground lg:block">
            {revenue ?? <span className="font-normal text-muted-foreground" aria-label="No revenue recorded">—</span>}
          </span>
          <span className="text-xs text-subtle-foreground lg:text-sm lg:text-muted-foreground">
            <span className="lg:hidden">· Updated </span>
            {c.last_interaction ? relativeAge(c.last_interaction, now) : "—"}
          </span>
        </span>
      </Link>
    </li>
  );
}

export default function CustomersList() {
  const { currentWorkspaceId, currentMembership } = useAuth();
  const role = currentMembership?.role;
  const canView = roleHasPermission(role, "opportunity.view");
  const canViewLeads = roleHasPermission(role, "lead.view");

  const [search, setSearch] = useState("");
  const query = useDebounced(search.trim(), 250);
  const [filters, setFilters] = useState<CustomerFilters>(DEFAULT_CUSTOMER_FILTERS);
  const [sort, setSort] = useState<CustomerSort>("updated");
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const filtersButtonRef = useRef<HTMLButtonElement>(null);
  const set = (patch: Partial<CustomerFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const [now] = useState(() => new Date());

  // Unsearched list drives the summary; the search shares its cache entry when empty.
  const allQuery = useCustomersSearch(canView ? currentWorkspaceId : null, "");
  const searchQuery = useCustomersSearch(canView ? currentWorkspaceId : null, query);
  const allRows = useMemo(() => allQuery.data ?? [], [allQuery.data]);
  const resultRows = useMemo(() => searchQuery.data ?? [], [searchQuery.data]);

  const summary = useMemo(() => summarizeCustomers(allRows), [allRows]);
  const owners = useMemo(() => ownerNames(allRows), [allRows]);
  const visible = useMemo(() => sortCustomers(filterCustomers(resultRows, filters), sort), [resultRows, filters, sort]);

  if (!canView) {
    return <EmptyState icon={Contact} title="Customers" description="You don't have permission to view customers in this workspace. Ask a workspace owner or admin." />;
  }

  if (!currentWorkspaceId || allQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-[1440px] space-y-4" role="status" aria-label="Loading customers">
        <div className="h-12 w-64 max-w-full animate-pulse rounded-lg bg-muted" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-[6.5rem] animate-pulse rounded-xl bg-muted" />)}</div>
        <div className="h-[50vh] animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  const loadError = allQuery.isError || searchQuery.isError;
  const searching = !!query;
  const anyFilter = customerFiltersActive(filters) || searching;
  const extraFilterCount = [filters.status !== "any", filters.owner !== "any", filters.openOnly].filter(Boolean).length;

  const headline = summary.total === 0
    ? "Everyone who becomes a customer, with their conversations, opportunities and revenue in one place."
    : [
        summary.withOpen ? `${summary.withOpen} ${summary.withOpen === 1 ? "customer has" : "customers have"} open opportunities` : "No open opportunities",
        summary.noOwner ? `${summary.noOwner} ${summary.noOwner === 1 ? "has" : "have"} no owner` : null,
      ].filter(Boolean).join(" · ");

  const filterControls = (
    <>
      <FilterField label="Status">
        <Select value={filters.status} onValueChange={(v) => set({ status: v as CustomerStatusFilter })}>
          <SelectTrigger className="lg:w-[8.5rem]" aria-label="Status"><SelectValue /></SelectTrigger>
          <SelectContent>{(Object.keys(STATUS_LABEL) as CustomerStatusFilter[]).map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
        </Select>
      </FilterField>
      <FilterField label="Owner">
        <Select value={filters.owner} onValueChange={(v) => set({ owner: v })}>
          <SelectTrigger className="lg:w-[10rem]" aria-label="Owner"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any owner</SelectItem>
            <SelectItem value="none">No owner</SelectItem>
            {owners.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterField>
      <FilterField label="Sort">
        <Select value={sort} onValueChange={(v) => setSort(v as CustomerSort)}>
          <SelectTrigger className="lg:w-[10.5rem]" aria-label="Sort"><SelectValue /></SelectTrigger>
          <SelectContent>{(Object.keys(SORT_LABEL) as CustomerSort[]).map((s) => <SelectItem key={s} value={s}>{SORT_LABEL[s]}</SelectItem>)}</SelectContent>
        </Select>
      </FilterField>
    </>
  );

  const clearAll = () => { setFilters(DEFAULT_CUSTOMER_FILTERS); setSearch(""); };

  let emptyList: ReactNode = null;
  if (!loadError && visible.length === 0 && !searchQuery.isLoading) {
    emptyList = allRows.length === 0 && !anyFilter ? (
      <EmptyState
        icon={Contact}
        title="No customers yet"
        description="A customer record is created when an opportunity is marked won. Their conversations, opportunities, revenue and documents then appear here."
        action={canViewLeads ? <Button asChild variant="outline"><Link to="/app/leads">Go to Leads</Link></Button> : undefined}
      />
    ) : (
      <EmptyState
        icon={Search}
        title="No customers match"
        description={searching ? `Nothing matches "${query}". Search covers name, phone, email and company.` : "Try different filters, or clear them to see every customer."}
        action={<Button variant="outline" onClick={clearAll}>Clear search and filters</Button>}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4">
      <header className="min-w-0">
        <h1 className="text-title-page text-foreground">Customers</h1>
        <p className="mt-1 text-sm text-muted-foreground">{headline}</p>
      </header>

      {loadError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load customers"
          description="Something went wrong fetching your customers. Your data is safe - try again."
          action={<Button variant="outline" onClick={() => { void allQuery.refetch(); void searchQuery.refetch(); }}>Try again</Button>}
          className="rounded-xl border border-border bg-card"
        />
      ) : (
        <>
          <section aria-label="Customer summary" className="-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4 [&>*]:min-w-[9.5rem] [&>*]:shrink-0 [&>*]:snap-start sm:[&>*]:min-w-0">
            <Metric label="Customers" state={{ kind: summary.total ? "value" : "zero", value: String(summary.total), note: summary.total >= CUSTOMERS_LIMIT ? `Showing the ${CUSTOMERS_LIMIT} most recent` : "Customer records" }} />
            <Metric label="Open opportunities" state={{ kind: summary.withOpen ? "value" : "zero", value: String(summary.withOpen), note: summary.withOpen ? "Customers with work in progress" : "No open work" }} />
            <Metric label="Without an owner" state={{ kind: summary.noOwner ? "value" : "zero", value: String(summary.noOwner), note: summary.noOwner ? "Assign someone responsible" : "Every customer has an owner" }} />
            <Metric
              label="Revenue recorded"
              state={summary.revenue.length ? {
                kind: "value",
                // Largest currency as the headline; other currencies listed, never summed.
                value: formatMinor(summary.revenue[0].currency, summary.revenue[0].total_minor),
                note: summary.revenue.length > 1 ? `+ ${formatRevenue(summary.revenue.slice(1))} · never summed` : "From recorded revenue events",
              } : { kind: "no_data", note: "No revenue recorded yet" }}
            />
          </section>

          <section aria-label="Customer workspace" className="flex min-h-[24rem] flex-col overflow-hidden rounded-xl border border-border bg-card">
            <div className="space-y-2 border-b border-border px-3 py-2.5">
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1 lg:max-w-[20rem]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, email or company" aria-label="Search customers" className="pl-9" />
                </div>
                <div className="hidden items-center gap-2 lg:flex">{filterControls}</div>
                <Button
                  variant={filters.openOnly ? "secondary" : "outline"}
                  aria-pressed={filters.openOnly}
                  className="hidden shrink-0 lg:inline-flex"
                  onClick={() => set({ openOnly: !filters.openOnly })}
                >
                  Has open work
                </Button>
                <Button ref={filtersButtonRef} variant="outline" className="shrink-0 lg:hidden" onClick={() => setFilterSheetOpen(true)} aria-label={`Filters${extraFilterCount ? `, ${extraFilterCount} active` : ""}`}>
                  <SlidersHorizontal aria-hidden="true" /><span className="hidden sm:inline">Filters</span>
                  {extraFilterCount ? <span className="rounded-full bg-selected px-1.5 text-xs text-selected-foreground">{extraFilterCount}</span> : null}
                </Button>
              </div>
              {anyFilter && (
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span aria-live="polite">{visible.length} {visible.length === 1 ? "customer" : "customers"}{searching && searchQuery.isFetching ? " · searching…" : ""}</span>
                  <button type="button" onClick={clearAll} className="inline-flex min-h-11 items-center px-1 font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0">Clear</button>
                </div>
              )}
            </div>

            {emptyList ?? (
              <>
                <div aria-hidden="true" className={`hidden border-b border-border bg-background/60 px-4 py-2 text-overline uppercase text-muted-foreground ${GRID}`}>
                  <span>Customer</span><span>Contact</span><span>Owner</span><span>Opportunities</span><span className="text-right">Revenue</span><span>Updated</span>
                </div>
                <ul aria-label="Customers" className={cn("divide-y divide-border", searchQuery.isFetching && searching && "opacity-70")}>
                  {visible.map((c) => <CustomerRow key={c.id} c={c} now={now} />)}
                </ul>
                {!searching && allRows.length >= CUSTOMERS_LIMIT && (
                  <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">Showing the {CUSTOMERS_LIMIT} most recently updated customers. Search finds anyone else.</p>
                )}
              </>
            )}
          </section>
        </>
      )}

      <Sheet open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] overflow-y-auto rounded-t-2xl pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
          // No SheetTrigger here, so hand focus back to the Filters button ourselves.
          onCloseAutoFocus={(e) => { e.preventDefault(); filtersButtonRef.current?.focus(); }}
        >
          <SheetHeader className="text-left">
            <SheetTitle>Filter customers</SheetTitle>
            <SheetDescription>{visible.length} {visible.length === 1 ? "customer matches" : "customers match"}</SheetDescription>
          </SheetHeader>
          <div className="mt-4 grid gap-3">
            {filterControls}
            <label className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border px-3 text-sm text-foreground">
              Only customers with open work
              <input type="checkbox" className="h-5 w-5 accent-[hsl(var(--primary))]" checked={filters.openOnly} onChange={(e) => set({ openOnly: e.target.checked })} />
            </label>
          </div>
          <div className="mt-5 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setFilters(DEFAULT_CUSTOMER_FILTERS)}>Reset</Button>
            <Button className="flex-1" onClick={() => setFilterSheetOpen(false)}>Show customers</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

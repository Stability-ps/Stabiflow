import { useMemo, useState, type ReactNode } from "react";
import { useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, ChevronLeft, ChevronRight, FileText, Mail, MessageCircle, Phone, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusPill } from "@/components/ui/status-pill";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/hooks/useAuth";
import { roleHasPermission } from "@/lib/permissions";
import { useCustomer360 } from "@/hooks/useCustomers";
import { formatMinor, type Customer360 as C360 } from "@/lib/customer";
import { signLeadAttachment } from "@/lib/leads";
import { formatBytes } from "@/lib/intakeDisplay";
import { inboxStatusLabel } from "@/lib/inboxPresentation";
import { sourceLabel } from "@/lib/leadsWorkspace";
import {
  conversationTone, customerStatusLabel, initials, isNotAuthorizedError, isNotFoundError, newestFirst, openWork, opportunityTone,
} from "@/lib/customersWorkspace";

function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function day(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

/** Opportunity values carry no currency on the record, so they're shown as plain amounts. */
function amount(v: number | null): string {
  return v == null ? "" : Number(v).toLocaleString("en-ZA", { maximumFractionDigits: 2 });
}

const humanize = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="px-4 py-3 text-sm text-muted-foreground">{children}</p>;
}

function DocumentRow({ workspaceId, doc }: { workspaceId: string; doc: C360["documents"][number] }) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const { url } = await signLeadAttachment(workspaceId, doc.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to open this document");
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex items-center justify-between gap-2 px-4 py-2.5">
      <span className="flex min-w-0 items-center gap-2 text-sm">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block truncate text-foreground">{doc.media_filename || "Attachment"}</span>
          <span className="block text-xs text-muted-foreground">
            {[doc.media_size_bytes != null ? formatBytes(doc.media_size_bytes) : null, day(doc.received_at || doc.created_at)].filter(Boolean).join(" · ")}
          </span>
        </span>
      </span>
      <Button size="sm" variant="ghost" className="min-h-11 shrink-0 text-primary hover:text-primary md:min-h-9" disabled={busy} onClick={open} aria-label={`Open ${doc.media_filename || "attachment"}`}>Open</Button>
    </li>
  );
}

function LinkedSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <Panel aria-label={title}>
      <PanelHeader title={<>{title} <span className="ml-1 text-sm font-normal text-muted-foreground">{count}</span></>} />
      {children}
    </Panel>
  );
}

export default function Customer360Page() {
  const { customerId } = useParams<{ customerId: string }>();
  const { currentWorkspaceId, currentMembership } = useAuth();
  const role = currentMembership?.role;
  const canView = roleHasPermission(role, "opportunity.view");
  const canViewLead = roleHasPermission(role, "lead.view");

  const query = useCustomer360(canView ? currentWorkspaceId : null, customerId ?? null);
  const { data, isLoading, error } = query;

  const timeline = useMemo(() => newestFirst(data?.timeline ?? [], (t) => t.at), [data?.timeline]);
  const notes = useMemo(() => newestFirst(data?.notes ?? [], (n) => n.created_at), [data?.notes]);
  const activity = useMemo(() => newestFirst(data?.activity ?? [], (a) => a.created_at), [data?.activity]);
  const work = useMemo(() => (data ? openWork(data) : []), [data]);

  // Phones already get a back button in the app header; this is the md+ equivalent.
  const back = (
    <Link to="/app/customers" className="hidden min-h-9 items-center gap-1 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex">
      <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Customers
    </Link>
  );

  if (!canView) return <EmptyState icon={User} title="Customer" description="You don't have permission to view customers in this workspace. Ask a workspace owner or admin." />;

  if (!currentWorkspaceId || isLoading) {
    return (
      <div className="mx-auto w-full max-w-[1440px] space-y-4" role="status" aria-label="Loading customer">
        <div className="h-28 animate-pulse rounded-xl bg-muted" />
        <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
          <div className="h-[50vh] animate-pulse rounded-xl bg-muted" />
          <div className="h-[50vh] animate-pulse rounded-xl bg-muted" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    const notFound = isNotFoundError(error) || (!error && !data);
    const notAllowed = isNotAuthorizedError(error);
    return (
      <div className="mx-auto w-full max-w-[1440px] space-y-2">
        {back}
        <EmptyState
          icon={notFound || notAllowed ? User : AlertTriangle}
          title={notFound ? "Customer not found" : notAllowed ? "You can't view this customer" : "Couldn't load this customer"}
          description={
            notFound ? "This customer doesn't exist, or belongs to another workspace."
              : notAllowed ? "This customer belongs to a workspace you're not a member of."
                : "Something went wrong fetching this customer record. Your data is safe - try again."
          }
          action={notFound || notAllowed ? <Button asChild variant="outline"><Link to="/app/customers">Back to Customers</Link></Button> : <Button variant="outline" onClick={() => void query.refetch()}>Try again</Button>}
          className="rounded-xl border border-border bg-card"
        />
      </div>
    );
  }

  const id = data.identity;
  const ws = currentWorkspaceId;
  const waNumber = id.phone ? id.phone.replace(/[^0-9]/g, "") : "";

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-4">
      {back}

      {/* 1-2. Identity + primary contact actions */}
      <Panel aria-label="Customer identity" className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-soft text-base font-semibold text-brand">{initials(id.name)}</span>
            <div className="min-w-0">
              <h1 className="break-words text-title-page text-foreground">{id.name}</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">{[id.company_name, `Customer since ${day(id.customer_since)}`].filter(Boolean).join(" · ")}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <StatusPill tone={id.status === "active" ? "success" : "neutral"}>{customerStatusLabel(id.status)}</StatusPill>
                {id.assigned_to_name ? <StatusPill tone="neutral" dot={false}>Owner · {id.assigned_to_name}</StatusPill> : <StatusPill tone="warning">No owner</StatusPill>}
              </div>
            </div>
          </div>
          {(id.phone || id.email) ? (
            <div className="grid grid-cols-3 gap-2 md:flex md:shrink-0">
              {id.phone && <Button asChild variant="outline"><a href={`tel:${id.phone}`}><Phone aria-hidden="true" />Call</a></Button>}
              {id.phone && <Button asChild variant="outline"><a href={`https://wa.me/${waNumber}`} target="_blank" rel="noreferrer"><MessageCircle aria-hidden="true" />WhatsApp</a></Button>}
              {id.email && <Button asChild variant="outline"><a href={`mailto:${id.email}`}><Mail aria-hidden="true" />Email</a></Button>}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground md:max-w-[14rem] md:text-right">No phone or email on file, so there's no way to contact them from here.</p>
          )}
        </div>
      </Panel>

      {/* DOM order = phone order (open work, timeline, relationship, linked records);
          from lg the relationship panel moves to a right rail beside both. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
          {/* 3. What's open right now */}
          <Panel aria-label="Open work">
            <PanelHeader title="Open work" description={work.length ? undefined : "Nothing open right now - no open opportunities or unresolved conversations."} />
            {work.length > 0 && (
              <ul className="divide-y divide-border">
                {work.map((w) => (
                  <li key={`${w.kind}-${w.id}`} className="flex items-center gap-3 px-4 py-3">
                    {w.kind === "conversation"
                      ? <StatusPill tone={conversationTone(w.status)} className="shrink-0">{inboxStatusLabel(w.status)}</StatusPill>
                      : <StatusPill tone="info" className="shrink-0">Open</StatusPill>}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{w.kind === "conversation" ? `WhatsApp · ${w.title}` : w.title}</span>
                      {w.meta && <span className="block truncate text-xs text-muted-foreground">{w.meta}</span>}
                    </span>
                    {w.kind === "conversation" && (
                      <Link to="/app/whatsapp/inbox" state={{ selectedId: w.id }} className="inline-flex min-h-11 shrink-0 items-center rounded px-1 text-sm font-medium text-primary hover:underline md:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        Open<span className="sr-only"> conversation with {w.title}</span>
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* 4. Activity / timeline */}
          <Panel aria-label="Timeline">
            <Tabs defaultValue="journey">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
                <h2 className="flex-1 text-title-card text-foreground">Timeline</h2>
                <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
                  <TabsTrigger value="journey" className="min-h-10 md:min-h-0">Journey {timeline.length ? <span className="ml-1 text-muted-foreground">{timeline.length}</span> : null}</TabsTrigger>
                  <TabsTrigger value="notes" className="min-h-10 md:min-h-0">Notes {notes.length ? <span className="ml-1 text-muted-foreground">{notes.length}</span> : null}</TabsTrigger>
                  <TabsTrigger value="activity" className="min-h-10 md:min-h-0"><span className="sm:hidden">Activity</span><span className="hidden sm:inline">Team activity</span> {activity.length ? <span className="ml-1 text-muted-foreground">{activity.length}</span> : null}</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="journey" className="mt-0">
                {timeline.length === 0 ? <Muted>Nothing recorded yet.</Muted> : (
                  <ol className="space-y-3 px-4 py-3">
                    {timeline.map((t, i) => (
                      <li key={i} className="flex gap-3">
                        <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-info" />
                        <span className="min-w-0">
                          <span className="block text-sm text-foreground">{t.label}</span>
                          <time dateTime={t.at} className="block text-xs text-muted-foreground">{when(t.at)}</time>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </TabsContent>
              <TabsContent value="notes" className="mt-0">
                {notes.length === 0 ? <Muted>No notes yet. Notes added to this customer's leads and opportunities appear here.</Muted> : (
                  <ul className="space-y-2 px-4 py-3">
                    {notes.map((n) => (
                      <li key={n.id} className="rounded-lg bg-muted/60 px-3 py-2">
                        <p className="text-xs text-muted-foreground">{n.author_name} · from the {n.target_type} · {when(n.created_at)}</p>
                        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground">{n.body}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
              <TabsContent value="activity" className="mt-0">
                {activity.length === 0 ? <Muted>No team activity recorded.</Muted> : (
                  <ol className="divide-y divide-border">
                    {activity.map((a) => (
                      <li key={a.id} className="flex flex-col gap-0.5 px-4 py-2.5 text-sm sm:flex-row sm:gap-3">
                        <time dateTime={a.created_at} className="shrink-0 text-xs text-muted-foreground sm:w-40 sm:pt-0.5">{when(a.created_at)}</time>
                        <span className="text-foreground">{humanize(a.action)}{a.actor_name ? <span className="text-muted-foreground"> · {a.actor_name}</span> : null}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </TabsContent>
            </Tabs>
          </Panel>
        </div>

        <div className="min-w-0 lg:sticky lg:top-[calc(var(--header-height)+1rem)] lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {/* 5. Relationship / context */}
          <Panel aria-label="Relationship">
            <PanelHeader title="Relationship" />
            <dl className="px-4 py-2">
              <Row label="Phone">{id.phone || <span className="text-muted-foreground">Not on file</span>}</Row>
              <Row label="Email">{id.email || <span className="text-muted-foreground">Not on file</span>}</Row>
              <Row label="Company">{id.company_name || <span className="text-muted-foreground">—</span>}</Row>
              <Row label="Owner">{id.assigned_to_name || <span className="font-medium text-warning">No owner</span>}</Row>
              <Row label="Customer since">{day(id.customer_since)}</Row>
              <Row label="Revenue">
                {data.revenue_by_currency.length === 0 ? <span className="text-muted-foreground">No revenue recorded</span> : (
                  <ul className="space-y-0.5">
                    {data.revenue_by_currency.map((r) => (
                      <li key={r.currency}><span className="font-medium tabular-nums">{formatMinor(r.currency, r.total_minor)}</span> <span className="text-xs text-muted-foreground">· {r.event_count ?? 0} {(r.event_count ?? 0) === 1 ? "event" : "events"}</span></li>
                    ))}
                    {data.revenue_by_currency.length > 1 && <li className="text-xs text-muted-foreground">Currencies are shown separately - never summed.</li>}
                  </ul>
                )}
              </Row>
              <Row label="First touch">
                {data.attribution ? (
                  <>
                    {[data.attribution.platform ? humanize(data.attribution.platform) : null, data.attribution.method ? `${humanize(data.attribution.method)}${data.attribution.confidence != null ? ` (${Math.round(data.attribution.confidence * 100)}%)` : ""}` : null].filter(Boolean).join(" · ") || "Recorded"}
                    <span className="block text-xs text-muted-foreground">{when(data.attribution.occurred_at)}</span>
                  </>
                ) : <span className="text-muted-foreground">No attribution evidence - organic, manual, or unknown</span>}
              </Row>
              <Row label="Record created">{day(id.created_at)}</Row>
            </dl>
          </Panel>
        </div>

        {/* 6. Linked records */}
        <div className="grid min-w-0 items-start gap-4 md:grid-cols-2 lg:col-start-1 lg:row-start-2">
          <LinkedSection title="Conversations" count={data.conversations.length}>
            {data.conversations.length === 0 ? <Muted>No linked conversations.</Muted> : (
              <ul className="divide-y divide-border">
                {data.conversations.map((c) => (
                  <li key={c.id}>
                    <Link to="/app/whatsapp/inbox" state={{ selectedId: c.id }} className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">{c.display_name || c.phone_number}</span>
                          <StatusPill tone={conversationTone(c.inbox_status)} className="shrink-0">{inboxStatusLabel(c.inbox_status)}</StatusPill>
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[c.ai_enabled ? "AI handling" : "Human handling", c.assigned_staff_name ? `Agent: ${c.assigned_staff_name}` : null, `Last message ${when(c.last_inbound_at || c.last_outbound_at || c.updated_at)}`].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </LinkedSection>

          <LinkedSection title="Opportunities" count={data.opportunities.length}>
            {data.opportunities.length === 0 ? <Muted>No opportunities.</Muted> : (
              <ul className="divide-y divide-border">
                {data.opportunities.map((o) => (
                  <li key={o.id} className="px-4 py-2.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{o.title}</span>
                      <StatusPill tone={opportunityTone(o.status)} className="shrink-0">{humanize(o.status)}</StatusPill>
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {[
                        [o.pipeline_name, o.stage_name].filter(Boolean).join(" / ") || null,
                        o.owner_name,
                        o.estimated_value != null ? `Est. ${amount(o.estimated_value)}` : null,
                        o.actual_value != null ? `Won ${amount(o.actual_value)}` : null,
                        o.won_at ? `Won ${day(o.won_at)}` : o.lost_at ? `Lost ${day(o.lost_at)}` : `Opened ${day(o.created_at)}`,
                      ].filter(Boolean).join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </LinkedSection>

          <LinkedSection title="Leads" count={data.leads.length}>
            {data.leads.length === 0 ? <Muted>No related leads.</Muted> : (
              <ul className="divide-y divide-border">
                {data.leads.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-foreground">{l.contact_name || l.human_reference}</span>
                        <StatusPill tone={l.qualification_status === "qualified" ? "success" : "neutral"}>{humanize(l.qualification_status)}</StatusPill>
                        {l.stage_name && <StatusPill tone="info" dot={false}>{l.stage_name}</StatusPill>}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {[l.contact_name ? l.human_reference : null, sourceLabel(l.source) + (l.source_detail ? ` - ${l.source_detail}` : ""), l.attribution?.campaign_id ? "Campaign-attributed" : l.attribution?.method ? humanize(l.attribution.method) : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {canViewLead && (
                      <Link to="/app/leads" state={{ selectedLeadId: l.id }} className="inline-flex min-h-11 shrink-0 items-center rounded px-1 text-sm font-medium text-primary hover:underline md:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        Open<span className="sr-only"> lead {l.human_reference}</span>
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </LinkedSection>

          <LinkedSection title="Documents" count={data.documents.length}>
            {data.documents.length === 0 ? <Muted>No documents.</Muted> : (
              <ul className="divide-y divide-border">{data.documents.map((d) => <DocumentRow key={d.id} workspaceId={ws} doc={d} />)}</ul>
            )}
          </LinkedSection>
        </div>
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Building2, FileText, Mail, Phone, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/hooks/useAuth";
import { roleHasPermission } from "@/lib/permissions";
import { useCustomer360 } from "@/hooks/useCustomers";
import { formatMinor, type Customer360 as C360 } from "@/lib/customer";
import { signLeadAttachment } from "@/lib/leads";
import { formatBytes } from "@/lib/intakeDisplay";

function when(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString();
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}{typeof count === "number" && <span className="ml-2 text-xs font-normal text-muted-foreground">{count}</span>}</CardTitle></CardHeader>
      <CardContent className="pt-0 text-sm">{children}</CardContent>
    </Card>
  );
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
    <div className="flex items-center justify-between gap-2 border-b py-1.5 last:border-b-0">
      <span className="flex min-w-0 items-center gap-1.5">
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{doc.media_filename || "Attachment"}</span>
        {doc.media_size_bytes != null && <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(doc.media_size_bytes)}</span>}
      </span>
      <Button size="sm" variant="ghost" className="h-7 shrink-0" disabled={busy} onClick={open}>Open</Button>
    </div>
  );
}

export default function Customer360Page() {
  const { customerId } = useParams<{ customerId: string }>();
  const navigate = useNavigate();
  const { currentWorkspaceId, currentMembership } = useAuth();
  const role = currentMembership?.role;
  const canView = roleHasPermission(role, "opportunity.view");
  const canViewLead = roleHasPermission(role, "lead.view");

  const { data, isLoading, error } = useCustomer360(canView ? currentWorkspaceId : null, customerId ?? null);

  const timeline = useMemo(
    () => (data?.timeline ?? []).slice().sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
    [data?.timeline],
  );

  if (!canView) return <EmptyState icon={User} title="Customer" description="You don't have permission to view customers in this workspace." />;
  if (isLoading) return <div className="h-[70vh] animate-pulse rounded-lg bg-muted" />;
  if (error || !data) {
    return <EmptyState icon={User} title="Customer not found" description="This customer doesn't exist, or belongs to another workspace." action={<Button onClick={() => navigate("/app/customers")}>Back to Customers</Button>} />;
  }

  const id = data.identity;
  const ws = currentWorkspaceId as string;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Button variant="ghost" size="sm" className="mb-1 -ml-2" onClick={() => navigate("/app/customers")}><ArrowLeft className="mr-1 h-4 w-4" /> Customers</Button>
          <h1 className="text-2xl font-semibold tracking-tight">{id.name}</h1>
          <p className="text-sm text-muted-foreground">Customer since {new Date(id.customer_since).toLocaleDateString()}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary" className="capitalize">{id.status}</Badge>
          {id.assigned_to_name && <Badge variant="outline">Owner: {id.assigned_to_name}</Badge>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Identity">
          <dl className="space-y-1">
            {id.company_name && <div className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-muted-foreground" /> {id.company_name}</div>}
            {id.phone && <div className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-muted-foreground" /> {id.phone}</div>}
            {id.email && <div className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-muted-foreground" /> {id.email}</div>}
            {!id.company_name && !id.phone && !id.email && <p className="text-muted-foreground">No additional contact details.</p>}
          </dl>
          <div className="mt-2 flex gap-3 text-xs text-muted-foreground">
            <span>{data.counts.conversations} conversation(s)</span>
            <span>{data.counts.leads} lead(s)</span>
            <span>{data.counts.open_opportunities}/{data.counts.opportunities} open opp(s)</span>
          </div>
        </Section>

        <Section title="Revenue">
          {data.revenue_by_currency.length === 0 ? (
            <p className="text-muted-foreground">No revenue recorded.</p>
          ) : (
            <ul className="space-y-1">
              {data.revenue_by_currency.map((r) => (
                <li key={r.currency} className="flex items-center justify-between">
                  <span className="font-medium tabular-nums">{formatMinor(r.currency, r.total_minor)}</span>
                  <span className="text-xs text-muted-foreground">{r.event_count ?? 0} event(s)</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">Currencies are shown separately - never summed.</p>
        </Section>

        <Section title="Attribution">
          {data.attribution ? (
            <div className="space-y-0.5">
              <p><span className="text-muted-foreground">Platform:</span> {data.attribution.platform || "-"}</p>
              <p><span className="text-muted-foreground">Method:</span> {data.attribution.method || "-"}{data.attribution.confidence != null ? ` (${Math.round(data.attribution.confidence * 100)}%)` : ""}</p>
              <p className="text-xs text-muted-foreground">First touchpoint {when(data.attribution.occurred_at)}</p>
            </div>
          ) : (
            <p className="text-muted-foreground">No attribution evidence - organic, manual, or unknown.</p>
          )}
        </Section>
      </div>

      <Section title="Timeline" count={timeline.length}>
        {timeline.length === 0 ? <p className="text-muted-foreground">Nothing recorded yet.</p> : (
          <ol className="space-y-1.5">
            {timeline.map((t, i) => (
              <li key={i} className="flex gap-2">
                <span className="w-40 shrink-0 text-xs text-muted-foreground">{when(t.at)}</span>
                <span>{t.label}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Conversations" count={data.conversations.length}>
          {data.conversations.length === 0 ? <p className="text-muted-foreground">No linked conversations.</p> : (
            <div className="space-y-1.5">
              {data.conversations.map((c) => (
                <Link key={c.id} to="/app/whatsapp/inbox" state={{ conversationId: c.id }} className="block rounded-md border p-2 text-xs hover:bg-muted/50">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{c.display_name || c.phone_number}</span>
                    <span className="flex gap-1">
                      <Badge variant="secondary" className="text-[10px] capitalize">{c.inbox_status.replace("_", " ")}</Badge>
                      <Badge variant="outline" className="text-[10px]">{c.ai_enabled ? "AI" : "Human"}</Badge>
                    </span>
                  </div>
                  <p className="text-muted-foreground">{c.assigned_staff_name ? `Agent: ${c.assigned_staff_name} · ` : ""}Last activity {when(c.last_inbound_at || c.last_outbound_at || c.updated_at)}</p>
                </Link>
              ))}
            </div>
          )}
        </Section>

        <Section title="Leads" count={data.leads.length}>
          {data.leads.length === 0 ? <p className="text-muted-foreground">No related leads.</p> : (
            <div className="space-y-1.5">
              {data.leads.map((l) => (
                <div key={l.id} className="rounded-md border p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{l.contact_name || l.human_reference}</span>
                    <span className="flex gap-1">
                      <Badge variant="secondary" className="text-[10px] capitalize">{l.qualification_status.replace("_", " ")}</Badge>
                      {l.stage_name && <Badge variant="outline" className="text-[10px]">{l.stage_name}</Badge>}
                    </span>
                  </div>
                  <p className="text-muted-foreground">
                    {l.source}{l.source_detail ? ` - ${l.source_detail}` : ""}
                    {l.attribution?.campaign_id ? " · campaign-attributed" : l.attribution?.method ? ` · ${l.attribution.method}` : ""}
                  </p>
                  {canViewLead && <Link to="/app/leads" state={{ selectedLeadId: l.id }} className="text-primary underline underline-offset-2">Open lead</Link>}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Opportunities" count={data.opportunities.length}>
          {data.opportunities.length === 0 ? <p className="text-muted-foreground">No opportunities.</p> : (
            <div className="space-y-1.5">
              {data.opportunities.map((o) => (
                <div key={o.id} className="rounded-md border p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{o.title}</span>
                    <Badge variant="secondary" className="text-[10px] capitalize">{o.status}</Badge>
                  </div>
                  <p className="text-muted-foreground">
                    {o.pipeline_name || "-"}{o.stage_name ? ` / ${o.stage_name}` : ""}
                    {o.owner_name ? ` · ${o.owner_name}` : ""}
                    {o.estimated_value != null ? ` · est ${o.estimated_value}` : ""}
                    {o.actual_value != null ? ` · won ${o.actual_value}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Documents" count={data.documents.length}>
          {data.documents.length === 0 ? <p className="text-muted-foreground">No documents.</p> : (
            <div>{data.documents.map((d) => <DocumentRow key={d.id} workspaceId={ws} doc={d} />)}</div>
          )}
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Notes" count={data.notes.length}>
          {data.notes.length === 0 ? <p className="text-muted-foreground">No notes.</p> : (
            <div className="space-y-1.5">
              {data.notes.map((n) => (
                <p key={n.id} className="rounded-md bg-amber-50 p-2 text-xs dark:bg-amber-950/20">
                  <span className="font-medium">{n.author_name}</span> <span className="text-muted-foreground">(from the {n.target_type})</span>: {n.body}
                </p>
              ))}
            </div>
          )}
        </Section>

        <Section title="Activity" count={data.activity.length}>
          {data.activity.length === 0 ? <p className="text-muted-foreground">No activity recorded.</p> : (
            <ol className="space-y-1 text-xs">
              {data.activity.map((a) => (
                <li key={a.id} className="flex gap-2">
                  <span className="w-36 shrink-0 text-muted-foreground">{when(a.created_at)}</span>
                  <span>{a.action.replace(/_/g, " ")}{a.actor_name ? ` - ${a.actor_name}` : ""}</span>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>
    </div>
  );
}

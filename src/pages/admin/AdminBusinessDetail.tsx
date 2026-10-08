// 360° view of one business for support and operations. Aggregates and
// metadata only - lead, message and document content is never loaded here.
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, CheckCircle2, Copy, ExternalLink, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AdminPageHeader, DataTable, EmptyNote, ErrorState, LoadingTiles, RequirePermission, Section, StatGrid, StatTile, Td, Th } from "@/components/admin/AdminPrimitives";
import { ConfirmActionDialog } from "@/components/admin/ConfirmActionDialog";
import { StatusBadge } from "@/pages/admin/AdminBusinesses";
import { WorkspaceCommercialPanel } from "@/pages/operator/WorkspaceCommercialPanel";
import { useAdmin } from "@/hooks/useAdmin";
import { adminConsole, type AdminBusinessDetail as Detail } from "@/lib/adminApi";
import { formatCount, formatDate, formatDateTime, formatMoney, formatUsd, humanize, timeAgo } from "@/lib/adminFormat";
import { suspendOperatorWorkspace, unsuspendOperatorWorkspace } from "@/lib/operator";

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text).then(() => toast.success("Copied"));
}

function healthIcon(ok: boolean | null) {
  if (ok === null) return null;
  return ok ? <CheckCircle2 className="inline h-3.5 w-3.5 text-emerald-600 dark:text-emerald-300" aria-label="Healthy" /> : <XCircle className="inline h-3.5 w-3.5 text-destructive" aria-label="Problem" />;
}

function BusinessDetail({ id }: { id: string }) {
  const { can } = useAdmin();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const q = useQuery({ queryKey: ["admin-business", id], queryFn: () => adminConsole<{ data: Detail }>("business", { id }).then((r) => r.data) });

  if (q.isLoading) return <LoadingTiles />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const b = q.data;
  const m = b.modules;
  const suspended = b.status === "suspended";
  const owner = b.members.find((x) => x.role === "owner");

  return (
    <>
      <Link to="/admin/businesses" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />Businesses</Link>
      <AdminPageHeader
        title={b.name}
        description={[b.identity?.legal_name && b.identity.legal_name !== b.name ? b.identity.legal_name : null, b.identity?.industry ?? b.settings?.industry, b.identity?.country_code].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            <StatusBadge status={b.status} />
            {b.paying ? <Badge>paying</Badge> : <Badge variant="outline">not paying</Badge>}
            <Button variant="outline" size="sm" onClick={() => copy(b.id)}><Copy className="mr-1.5 h-3.5 w-3.5" />Copy ID</Button>
            {b.hosted_profile?.is_published ? (
              <Button asChild variant="outline" size="sm"><a href={`/b/${b.hosted_profile.slug}`} target="_blank" rel="noreferrer"><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Public profile</a></Button>
            ) : null}
            {can("businesses.manage") ? (
              <Button variant={suspended ? "default" : "destructive"} size="sm" onClick={() => setConfirm(true)}>
                {suspended ? <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> : <Ban className="mr-1.5 h-3.5 w-3.5" />}{suspended ? "Reactivate" : "Suspend"}
              </Button>
            ) : null}
          </>
        }
      />

      <StatGrid>
        <StatTile label="Plan" value={b.plan_codes.length ? b.plan_codes.join(", ") : "free"} sub={b.trial_ends_at ? `Trial ends ${formatDate(b.trial_ends_at)}` : `Created ${formatDate(b.created_at)}`} />
        <StatTile label="Team" value={formatCount(b.members.length)} sub={b.pending_invitations ? `${b.pending_invitations} pending invitations` : "No pending invitations"} />
        <StatTile label="Leads" value={formatCount(m.leads)} sub={`${formatCount(m.customers)} customers · ${formatCount(m.opportunities)} opportunities`} />
        <StatTile label="WhatsApp" value={formatCount(m.messages_30d)} sub={`messages in 30 days · ${formatCount(m.conversations)} conversations`} />
        <StatTile label="Automations" value={formatCount(m.automations_active)} sub={`active of ${m.automations} · ${m.automation_runs_30d} runs, ${m.automation_failures_30d} failed (30d)`} tone={m.automation_failures_30d > 0 ? "warning" : "default"} />
        <StatTile label="AI usage · 30 days" value={formatCount(m.ai_calls_30d)} sub={`${formatCount(m.ai_tokens_30d)} tokens · ${formatUsd(m.ai_cost_usd_30d)}`} />
        <StatTile label="Content" value={formatCount(m.posts_published)} sub={`posts published · ${m.posts_failed_30d} failed (30d)`} tone={m.posts_failed_30d > 0 ? "warning" : "default"} />
        <StatTile label="Studios" value={formatCount(m.creative_concepts)} sub={`creative concepts · ${m.campaigns} campaigns · ${m.website_scans} website scans`} />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Team">
          <ul className="divide-y">
            {b.members.map((mem) => (
              <li key={mem.user_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  {can("users.read") ? <Link to={`/admin/users/${mem.user_id}`} className="font-medium hover:underline">{mem.full_name || mem.email}</Link> : <span className="font-medium">{mem.full_name || "Member"}</span>}
                  {mem.email && mem.full_name ? <p className="truncate text-xs text-muted-foreground">{mem.email}</p> : null}
                </div>
                <div className="shrink-0 text-right text-xs text-muted-foreground"><Badge variant="outline" className="mb-0.5 text-[10px]">{mem.role}</Badge><br />signed in {timeAgo(mem.last_sign_in_at)}</div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Account">
          <KV label="Business ID"><span className="font-mono text-xs">{b.id}</span></KV>
          <KV label="Slug">{b.slug}</KV>
          <KV label="Owner">{owner ? (owner.full_name || owner.email || "—") : "—"}</KV>
          <KV label="Created">{formatDateTime(b.created_at)}</KV>
          <KV label="Timezone">{b.settings?.timezone ?? "—"}</KV>
          <KV label="Currency">{b.settings?.currency ?? "—"}</KV>
          <KV label="Website">{b.settings?.website ?? "—"}</KV>
          <KV label="Identity verification">{humanize(b.identity?.verification_status)}</KV>
          <KV label="Public profile">{b.hosted_profile ? (b.hosted_profile.is_published ? `Live since ${formatDate(b.hosted_profile.published_at)}` : "Draft") : "Not created"}</KV>
        </Section>
      </div>

      <Section title="Integrations" description="Connection health only. Access tokens are never shown.">
        {b.integrations.length === 0 && b.whatsapp_numbers.length === 0 ? <EmptyNote>No Meta or WhatsApp connection.</EmptyNote> : (
          <div className="space-y-3">
            {b.integrations.map((i) => (
              <div key={i.provider} className="grid gap-1 rounded-lg border p-3 text-sm sm:grid-cols-4">
                <div className="font-medium">{i.provider === "meta" ? "Meta" : "WhatsApp"} <Badge variant={i.status === "connected" ? "secondary" : i.status === "error" ? "destructive" : "outline"} className="ml-1 text-[10px]">{i.status}</Badge></div>
                <div className="text-xs text-muted-foreground">Health {healthIcon(i.last_health_check_status ? ["ok", "healthy", "success"].includes(i.last_health_check_status) : null)} {i.last_health_check_status ?? "not checked"} · {timeAgo(i.last_health_check_at)}</div>
                <div className="text-xs text-muted-foreground">Last success {timeAgo(i.last_success_at)}{i.webhook_subscription_status ? ` · webhook ${i.webhook_subscription_status}` : ""}</div>
                <div className="text-xs text-muted-foreground">{i.token_expires_at ? `Token expires ${formatDate(i.token_expires_at)}` : "No token expiry recorded"}</div>
              </div>
            ))}
            {b.whatsapp_numbers.map((n, idx) => (
              <div key={idx} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{n.verified_name ?? "WhatsApp number"}</span>
                <span>{n.display_phone_number}</span>
                <Badge variant="outline" className="text-[10px]">{n.is_active ? "active" : "inactive"}</Badge>
                {n.quality_rating ? <span>quality {n.quality_rating}</span> : null}
                {n.platform_status ? <span>· {n.platform_status}</span> : null}
              </div>
            ))}
          </div>
        )}
      </Section>

      {b.billing_hidden ? null : (
        <Section title="Billing" description="From verified Paystack transactions and subscription records.">
          <div className="space-y-4">
            {b.subscriptions.length === 0 && b.purchases.length === 0 ? <EmptyNote>No subscriptions or purchases.</EmptyNote> : null}
            {b.subscriptions.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border p-3 text-sm">
                <span className="font-medium">{s.plan ?? "Subscription"}</span>
                <Badge variant={s.status === "active" ? "secondary" : ["past_due", "grace"].includes(s.status) ? "destructive" : "outline"} className="text-[10px]">{s.status.replace("_", " ")}</Badge>
                {s.amount_minor !== null && s.currency ? <span className="text-xs">{formatMoney(s.amount_minor, s.currency)} / {s.interval}</span> : null}
                <span className="text-xs text-muted-foreground">since {formatDate(s.created_at)}</span>
                {s.current_period_end ? <span className="text-xs text-muted-foreground">{s.cancel_at_period_end ? "ends" : "renews"} {formatDate(s.current_period_end)}</span> : null}
                {s.grace_until ? <span className="text-xs text-destructive">grace until {formatDate(s.grace_until)}</span> : null}
              </div>
            ))}
            {b.purchases.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border p-3 text-sm">
                <span className="font-medium">{p.plan ?? "Purchase"}</span>
                <Badge variant="outline" className="text-[10px]">{p.status}</Badge>
                <span className="text-xs">{formatMoney(p.amount_minor, p.currency)}</span>
                <span className="text-xs text-muted-foreground">{p.paid_at ? `paid ${formatDate(p.paid_at)}` : "unpaid"}{p.access_expires_at ? ` · access until ${formatDate(p.access_expires_at)}` : ""}</span>
              </div>
            ))}
            {b.transactions.length ? (
              <DataTable minWidth={640}>
                <thead><tr><Th>Reference</Th><Th>Type</Th><Th>Status</Th><Th>Amount</Th><Th>Date</Th></tr></thead>
                <tbody>
                  {b.transactions.map((t) => (
                    <tr key={t.id}>
                      <Td><button type="button" className="font-mono text-xs hover:underline" onClick={() => copy(t.reference)} title="Copy reference">{t.reference}</button></Td>
                      <Td className="text-xs">{humanize(t.kind)}</Td>
                      <Td className="text-xs">{t.status}{t.failure_reason ? <span className="block text-muted-foreground">{t.failure_reason}</span> : null}</Td>
                      <Td className="text-xs tabular-nums">{formatMoney(t.paid_amount_minor ?? t.amount_minor, t.paid_currency ?? t.currency)}</Td>
                      <Td className="whitespace-nowrap text-xs">{formatDateTime(t.paid_at ?? t.created_at)}</Td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            ) : null}
          </div>
        </Section>
      )}

      <Section title="Plan allowances & usage" description="Current entitlements and this month's usage.">
        {b.usage.length === 0 ? <EmptyNote>No entitlements.</EmptyNote> : (
          <DataTable minWidth={560}>
            <thead><tr><Th>Entitlement</Th><Th>Access</Th><Th>Used</Th><Th>Limit</Th><Th>Source</Th></tr></thead>
            <tbody>
              {b.usage.map((u) => {
                const pct = u.limit && !u.unlimited ? u.used / u.limit : 0;
                return (
                  <tr key={u.key}>
                    <Td className="text-xs">{humanize(u.key)}</Td>
                    <Td className="text-xs">{u.enabled ? "Yes" : "No"}</Td>
                    <Td className={`text-xs tabular-nums ${pct >= 1 ? "font-semibold text-destructive" : pct >= 0.8 ? "font-semibold" : ""}`}>{u.kind === "boolean" ? "—" : formatCount(u.used)}</Td>
                    <Td className="text-xs tabular-nums">{u.kind === "boolean" ? "—" : u.unlimited ? "Unlimited" : formatCount(u.limit)}</Td>
                    <Td className="text-xs text-muted-foreground">{humanize(u.source)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </Section>

      {/* The panel mixes entitlement overrides (billing.manage) with module targeting (features.manage). */}
      {can("billing.manage") && can("features.manage") ? (
        <Section title="Entitlement overrides & module access" description="Grant or restrict features for this business only. Every change needs a reason and is audited.">
          <WorkspaceCommercialPanel workspaceId={b.id} />
        </Section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Recent activity" description="Actions recorded in this business (no content).">
          {b.recent_activity.length === 0 ? <EmptyNote>No activity recorded.</EmptyNote> : (
            <ul className="space-y-1.5 text-sm">
              {b.recent_activity.map((a, i) => <li key={i} className="flex justify-between gap-3"><span className="truncate">{humanize(a.action)}{a.actor_name ? <span className="text-muted-foreground"> · {a.actor_name}</span> : null}</span><span className="shrink-0 text-xs text-muted-foreground">{timeAgo(a.created_at)}</span></li>)}
            </ul>
          )}
        </Section>
        <Section title="Staff actions on this business">
          {b.admin_history.length === 0 ? <EmptyNote>No staff actions yet.</EmptyNote> : (
            <ul className="space-y-1.5 text-sm">
              {b.admin_history.map((a, i) => <li key={i}><span className="font-medium">{humanize(a.action)}</span> <span className="text-xs text-muted-foreground">by {a.operator_name ?? "staff"} · {formatDateTime(a.created_at)}</span>{a.reason ? <p className="text-xs text-muted-foreground">“{a.reason}”</p> : null}</li>)}
            </ul>
          )}
        </Section>
      </div>

      <ConfirmActionDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={suspended ? `Reactivate ${b.name}?` : `Suspend ${b.name}?`}
        description={suspended
          ? "AI, automations, messaging and publishing resume immediately."
          : "Flow AI, automations, Creative Studio, WhatsApp sending and content/ad publishing stop until it is reactivated. Members can still sign in and read their data. Nothing is deleted."}
        current={b.status}
        proposed={suspended ? "active" : "suspended"}
        confirmLabel={suspended ? "Reactivate business" : "Suspend business"}
        destructive={!suspended}
        onConfirm={async (reason) => {
          await (suspended ? unsuspendOperatorWorkspace(b.id, reason) : suspendOperatorWorkspace(b.id, reason));
          toast.success(suspended ? "Business reactivated" : "Business suspended");
          await qc.invalidateQueries({ queryKey: ["admin-business", id] });
        }}
      />
    </>
  );
}

export default function AdminBusinessDetail() {
  const { id = "" } = useParams();
  return <RequirePermission permission="businesses.read"><BusinessDetail id={id} /></RequirePermission>;
}

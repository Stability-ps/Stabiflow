import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Copy } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AdminPageHeader, EmptyNote, ErrorState, LoadingTiles, RequirePermission, Section, StatGrid, StatTile } from "@/components/admin/AdminPrimitives";
import { StatusBadge } from "@/pages/admin/AdminBusinesses";
import { adminConsole, type AdminUserDetail as Detail } from "@/lib/adminApi";
import { ROLE_LABELS } from "@/lib/adminPermissions";
import { formatCount, formatDate, formatDateTime, formatUsd, humanize, timeAgo } from "@/lib/adminFormat";

function UserDetail({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["admin-user", id], queryFn: () => adminConsole<{ data: Detail }>("user", { id }).then((r) => r.data) });
  if (q.isLoading) return <LoadingTiles count={4} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const u = q.data;

  return (
    <>
      <Link to="/admin/users" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />Users</Link>
      <AdminPageHeader
        title={u.full_name || u.email}
        description={u.full_name ? u.email : undefined}
        actions={
          <>
            {u.email_confirmed_at ? <Badge variant="secondary">Email confirmed</Badge> : <Badge variant="outline">Email not confirmed</Badge>}
            {u.admin_role ? <Badge>Staff · {ROLE_LABELS[u.admin_role].label}</Badge> : null}
            <Button variant="outline" size="sm" onClick={() => void navigator.clipboard?.writeText(u.id).then(() => toast.success("Copied"))}><Copy className="mr-1.5 h-3.5 w-3.5" />Copy ID</Button>
          </>
        }
      />

      <StatGrid>
        <StatTile label="Signed up" value={formatDate(u.created_at)} sub={timeAgo(u.created_at)} />
        <StatTile label="Last sign-in" value={u.last_sign_in_at ? timeAgo(u.last_sign_in_at) : "Never"} sub={formatDateTime(u.last_sign_in_at)} />
        <StatTile label="Businesses" value={formatCount(u.workspaces.length)} sub={u.workspaces.length ? u.workspaces.map((w) => w.role).join(", ") : "Not in any business"} tone={u.workspaces.length === 0 ? "warning" : "default"} />
        <StatTile label="AI usage · 30 days" value={formatCount(u.ai_30d.calls)} sub={`${formatCount(u.ai_30d.tokens)} tokens · ${formatUsd(u.ai_30d.cost_usd)}`} />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Businesses">
          {u.workspaces.length === 0 ? <EmptyNote>This account has not created or joined a business.</EmptyNote> : (
            <ul className="divide-y">
              {u.workspaces.map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <Link to={`/admin/businesses/${w.id}`} className="font-medium hover:underline">{w.name}</Link>
                    <p className="text-xs text-muted-foreground">{w.role} · joined {formatDate(w.joined_at)} · {w.plan_codes.length ? w.plan_codes.join(", ") : "free"}</p>
                  </div>
                  <StatusBadge status={w.status} />
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Identity">
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">User ID</dt><dd className="font-mono text-xs">{u.id}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Sign-in methods</dt><dd>{u.providers.length ? u.providers.join(", ") : "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Email confirmed</dt><dd>{formatDateTime(u.email_confirmed_at)}</dd></div>
            {u.legal.map((l) => (
              <div key={`${l.document_type}-${l.version}`} className="flex justify-between gap-3"><dt className="text-muted-foreground">{humanize(l.document_type)}</dt><dd>v{l.version} · accepted {formatDate(l.accepted_at)}</dd></div>
            ))}
            {u.legal.length === 0 ? <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Legal acceptance</dt><dd>None recorded</dd></div> : null}
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">Passwords and sign-in tokens are never visible to staff.</p>
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Recent activity" description="Actions this user performed (no content).">
          {u.recent_activity.length === 0 ? <EmptyNote>No recorded activity.</EmptyNote> : (
            <ul className="space-y-1.5 text-sm">
              {u.recent_activity.map((a, i) => <li key={i} className="flex justify-between gap-3"><span className="truncate">{humanize(a.action)}<span className="text-muted-foreground"> · {a.workspace_name}</span></span><span className="shrink-0 text-xs text-muted-foreground">{timeAgo(a.created_at)}</span></li>)}
            </ul>
          )}
        </Section>
        <Section title="Staff actions on this account">
          {u.admin_history.length === 0 ? <EmptyNote>No staff actions yet.</EmptyNote> : (
            <ul className="space-y-1.5 text-sm">
              {u.admin_history.map((a, i) => <li key={i}><span className="font-medium">{humanize(a.action)}</span> <span className="text-xs text-muted-foreground">by {a.operator_name ?? "staff"} · {formatDateTime(a.created_at)}</span>{a.reason ? <p className="text-xs text-muted-foreground">“{a.reason}”</p> : null}</li>)}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}

export default function AdminUserDetail() {
  const { id = "" } = useParams();
  return <RequirePermission permission="users.read"><UserDetail id={id} /></RequirePermission>;
}

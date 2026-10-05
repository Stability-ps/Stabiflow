// Staff & roles (Owner only). Grant/change/revoke go through admin-console,
// which refuses self-changes, protects the last owner and audits everything.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AdminPageHeader, DataTable, ErrorState, LoadingRows, RequirePermission, Section, Td, Th } from "@/components/admin/AdminPrimitives";
import { ConfirmActionDialog } from "@/components/admin/ConfirmActionDialog";
import { useAdmin } from "@/hooks/useAdmin";
import { adminConsole, type AdminStaffRow } from "@/lib/adminApi";
import { ADMIN_ROLES, ROLE_LABELS, type AdminPermission, type AdminRole } from "@/lib/adminPermissions";
import { formatDate, timeAgo } from "@/lib/adminFormat";

type Pending =
  | { kind: "grant"; email: string; role: AdminRole; current: AdminRole | null }
  | { kind: "revoke"; row: AdminStaffRow };

function StaffView() {
  const { userId } = useAdmin();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin-staff"],
    queryFn: () => adminConsole<{ rows: AdminStaffRow[]; roles: { role: AdminRole; label: string; description: string; permissions: AdminPermission[] }[] }>("staff"),
  });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdminRole>("support");
  const [pending, setPending] = useState<Pending | null>(null);
  const rows = q.data?.rows ?? [];

  const done = async (msg: string) => {
    toast.success(msg);
    await qc.invalidateQueries({ queryKey: ["admin-staff"] });
  };

  return (
    <>
      <AdminPageHeader title="Staff & roles" description="Who can open StabiFlow Admin and what each role may do. Roles are enforced on the server for every request." />

      <Section title="Add or change a staff member" description="The person must already have a StabiFlow account.">
        <form
          className="flex flex-col gap-3 md:flex-row md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const existing = rows.find((r) => r.email.toLowerCase() === email.trim().toLowerCase());
            setPending({ kind: "grant", email: email.trim(), role, current: existing?.role ?? null });
          }}
        >
          <div className="flex-1 space-y-1.5"><Label htmlFor="staff-email">Account email</Label><Input id="staff-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" /></div>
          <div className="space-y-1.5">
            <Label htmlFor="staff-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as AdminRole)}>
              <SelectTrigger id="staff-role" className="md:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>{ADMIN_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r].label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={!email.includes("@")}><UserPlus className="mr-1.5 h-4 w-4" />Review change</Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">{ROLE_LABELS[role].description}</p>
      </Section>

      <Section title={`${rows.length} staff ${rows.length === 1 ? "member" : "members"}`}>
        {q.isLoading ? <LoadingRows rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
          <DataTable minWidth={640}>
            <thead><tr><Th>Person</Th><Th>Role</Th><Th>Granted</Th><Th>Last sign-in</Th><Th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id}>
                  <Td><span className="font-medium">{r.full_name || r.email}</span>{r.full_name ? <span className="block text-xs text-muted-foreground">{r.email}</span> : null}</Td>
                  <Td><Badge variant={r.role === "owner" ? "default" : "secondary"}>{ROLE_LABELS[r.role].label}</Badge></Td>
                  <Td className="text-xs">{formatDate(r.created_at)}{r.granted_by_name ? <span className="block text-muted-foreground">by {r.granted_by_name}</span> : null}</Td>
                  <Td className="text-xs">{timeAgo(r.last_sign_in_at)}</Td>
                  <Td className="text-right">
                    {r.user_id === userId ? <span className="text-xs text-muted-foreground">You</span> : (
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setPending({ kind: "revoke", row: r })}>Remove access</Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Section>

      {q.data ? (
        <Section title="What each role can do">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {q.data.roles.map((r) => (
              <div key={r.role} className="rounded-lg border p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium"><ShieldCheck className="h-4 w-4 text-muted-foreground" />{r.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{r.description}</p>
                <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">{r.permissions.join(" · ")}</p>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <ConfirmActionDialog
        open={pending !== null}
        onOpenChange={(o) => { if (!o) setPending(null); }}
        title={pending?.kind === "revoke" ? `Remove ${pending.row.full_name || pending.row.email}'s access?` : pending?.current ? "Change staff role?" : "Grant staff access?"}
        description={pending?.kind === "revoke" ? "They will immediately lose access to StabiFlow Admin. Their customer account is not affected." : `${pending?.kind === "grant" ? pending.email : ""} will be able to: ${pending?.kind === "grant" ? ROLE_LABELS[pending.role].description : ""}`}
        current={pending?.kind === "revoke" ? ROLE_LABELS[pending.row.role].label : pending?.current ? ROLE_LABELS[pending.current].label : "No staff access"}
        proposed={pending?.kind === "revoke" ? "No staff access" : pending ? ROLE_LABELS[pending.role].label : ""}
        confirmLabel={pending?.kind === "revoke" ? "Remove access" : "Save role"}
        destructive={pending?.kind === "revoke" || (pending?.kind === "grant" && pending.role === "owner")}
        onConfirm={async (reason) => {
          if (!pending) return;
          if (pending.kind === "revoke") {
            await adminConsole("revoke_role", { user_id: pending.row.user_id, reason });
            await done("Access removed");
          } else {
            await adminConsole("grant_role", { email: pending.email, role: pending.role, reason });
            setEmail("");
            await done("Role saved");
          }
        }}
      />
    </>
  );
}

export default function AdminStaff() {
  return <RequirePermission permission="admins.manage"><StaffView /></RequirePermission>;
}

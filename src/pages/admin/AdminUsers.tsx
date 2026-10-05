import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AdminPageHeader, DataTable, EmptyNote, ErrorState, LoadingRows, Pager, RequirePermission, Section, Td, Th } from "@/components/admin/AdminPrimitives";
import { DirectoryControls } from "@/components/admin/DirectoryControls";
import { useDirectoryState } from "@/hooks/useDirectoryState";
import { ExportButton } from "@/components/admin/ExportButton";
import { adminConsole, type AdminUserRow, type Paged } from "@/lib/adminApi";
import { ROLE_LABELS } from "@/lib/adminPermissions";
import { formatDate, timeAgo } from "@/lib/adminFormat";

const FILTERS = [
  { value: "all", label: "All users" },
  { value: "new_7d", label: "Joined in the last 7 days" },
  { value: "inactive_30d", label: "No sign-in for 30+ days" },
  { value: "no_workspace", label: "No business yet" },
  { value: "unconfirmed", label: "Email not confirmed" },
  { value: "staff", label: "StabiFlow staff" },
];
const PAGE_SIZE = 25;

export function UsersDirectory() {
  const st = useDirectoryState();
  const q = useQuery({
    queryKey: ["admin-users", st.search, st.filter, st.page],
    queryFn: () => adminConsole<Paged<AdminUserRow>>("users", { search: st.search, filter: st.filter, page: st.page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <AdminPageHeader
        title="Users"
        description="Every StabiFlow account, the businesses it belongs to, and when it last signed in."
        actions={<ExportButton dataset="users" filters={{ search: st.search, filter: st.filter }} />}
      />
      <Section title={q.data ? `${q.data.total.toLocaleString()} ${q.data.total === 1 ? "user" : "users"}` : "Users"}>
        <div className="space-y-4">
          <DirectoryControls search={st.search} filter={st.filter} filters={FILTERS} placeholder="Search by name, email or user ID" onChange={st.set} />
          {q.isLoading ? <LoadingRows rows={8} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data!.rows.length === 0 ? (
            <EmptyNote icon={Users}>No users match these filters.</EmptyNote>
          ) : (
            <>
              <DataTable>
                <thead><tr><Th>User</Th><Th>Businesses</Th><Th>Signed up</Th><Th>Last sign-in</Th><Th>Status</Th></tr></thead>
                <tbody className={q.isPlaceholderData ? "opacity-60" : undefined}>
                  {q.data!.rows.map((u) => (
                    <tr key={u.id} className="hover:bg-accent/30">
                      <Td>
                        <Link to={`/admin/users/${u.id}`} className="font-medium hover:underline">{u.full_name || u.email}</Link>
                        {u.full_name ? <p className="text-xs text-muted-foreground">{u.email}</p> : null}
                      </Td>
                      <Td>
                        {u.workspaces.length === 0 ? <span className="text-xs text-muted-foreground">None</span> : (
                          <ul className="space-y-0.5 text-xs">
                            {u.workspaces.slice(0, 3).map((w) => (
                              <li key={w.id}><Link to={`/admin/businesses/${w.id}`} className="hover:underline">{w.name}</Link> <span className="text-muted-foreground">· {w.role}</span>{w.status === "suspended" ? <Badge variant="destructive" className="ml-1 px-1.5 py-0 text-[10px]">suspended</Badge> : null}</li>
                            ))}
                            {u.workspaces.length > 3 ? <li className="text-muted-foreground">+{u.workspaces.length - 3} more</li> : null}
                          </ul>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap text-xs">{formatDate(u.created_at)}</Td>
                      <Td className="whitespace-nowrap text-xs">{timeAgo(u.last_sign_in_at)}</Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {!u.email_confirmed ? <Badge variant="outline" className="text-[10px]">Unconfirmed</Badge> : null}
                          {u.admin_role ? <Badge variant="secondary" className="text-[10px]">Staff · {ROLE_LABELS[u.admin_role].label}</Badge> : null}
                          {u.email_confirmed && !u.admin_role ? <span className="text-xs text-muted-foreground">Active</span> : null}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
              <Pager page={st.page} pageSize={PAGE_SIZE} total={q.data!.total} onPage={(p) => st.set({ page: p })} />
            </>
          )}
        </div>
      </Section>
    </>
  );
}

export default function AdminUsers() {
  return <RequirePermission permission="users.read"><UsersDirectory /></RequirePermission>;
}

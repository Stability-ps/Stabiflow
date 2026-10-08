import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AdminPageHeader, DataTable, EmptyNote, ErrorState, LoadingRows, Pager, RequirePermission, Section, Td, Th } from "@/components/admin/AdminPrimitives";
import { DirectoryControls } from "@/components/admin/DirectoryControls";
import { useDirectoryState } from "@/hooks/useDirectoryState";
import { ExportButton } from "@/components/admin/ExportButton";
import { adminConsole, type AdminBusinessRow, type Paged } from "@/lib/adminApi";
import { formatDate, formatMoney, timeAgo } from "@/lib/adminFormat";

const FILTERS = [
  { value: "all", label: "All businesses" },
  { value: "paying", label: "Paying" },
  { value: "free", label: "Not paying" },
  { value: "new_30d", label: "Created in the last 30 days" },
  { value: "inactive_30d", label: "No activity for 30+ days" },
  { value: "suspended", label: "Suspended" },
];
const PAGE_SIZE = 25;

export function StatusBadge({ status }: { status: string }) {
  if (status === "suspended" || status === "cancelled") return <Badge variant="destructive" className="text-[10px]">{status}</Badge>;
  if (status === "trial") return <Badge variant="outline" className="text-[10px]">trial</Badge>;
  return <Badge variant="secondary" className="text-[10px]">{status}</Badge>;
}

function BusinessesDirectory() {
  const st = useDirectoryState();
  const q = useQuery({
    queryKey: ["admin-businesses", st.search, st.filter, st.page],
    queryFn: () => adminConsole<Paged<AdminBusinessRow>>("businesses", { search: st.search, filter: st.filter, page: st.page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <AdminPageHeader
        title="Businesses"
        description="Every StabiFlow business (workspace): owner, plan, team size, lifetime revenue and recent activity."
        actions={<ExportButton dataset="businesses" filters={{ search: st.search, filter: st.filter }} />}
      />
      <Section title={q.data ? `${q.data.total.toLocaleString()} ${q.data.total === 1 ? "business" : "businesses"}` : "Businesses"}>
        <div className="space-y-4">
          <DirectoryControls search={st.search} filter={st.filter} filters={FILTERS} placeholder="Search by business name, slug, ID or member email" onChange={st.set} />
          {q.isLoading ? <LoadingRows rows={8} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data!.rows.length === 0 ? (
            <EmptyNote icon={Building2}>No businesses match these filters.</EmptyNote>
          ) : (
            <>
              <DataTable minWidth={860}>
                <thead><tr><Th>Business</Th><Th>Owner</Th><Th>Plan</Th><Th>Team</Th><Th>Lifetime revenue</Th><Th>Created</Th><Th>Last activity</Th></tr></thead>
                <tbody className={q.isPlaceholderData ? "opacity-60" : undefined}>
                  {q.data!.rows.map((b) => (
                    <tr key={b.id} className="hover:bg-accent/30">
                      <Td>
                        <Link to={`/admin/businesses/${b.id}`} className="font-medium hover:underline">{b.name}</Link>
                        <div className="mt-0.5 flex items-center gap-1"><StatusBadge status={b.status} />{b.country_code ? <span className="text-[10px] text-muted-foreground">{b.country_code}</span> : null}</div>
                      </Td>
                      <Td className="text-xs">{b.owner ? <Link to={`/admin/users/${b.owner.id}`} className="hover:underline">{b.owner.full_name || b.owner.email}</Link> : <span className="text-muted-foreground">—</span>}</Td>
                      <Td className="text-xs">
                        {b.plan_codes.length ? b.plan_codes.join(", ") : "free"}
                        {b.paying ? <Badge className="ml-1 px-1.5 py-0 text-[10px]">paying</Badge> : null}
                      </Td>
                      <Td className="text-xs tabular-nums">{b.members}</Td>
                      <Td className="text-xs tabular-nums">{b.revenue.length ? b.revenue.map((r) => <div key={r.currency}>{formatMoney(r.gross_minor, r.currency)}</div>) : <span className="text-muted-foreground">—</span>}</Td>
                      <Td className="whitespace-nowrap text-xs">{formatDate(b.created_at)}</Td>
                      <Td className="whitespace-nowrap text-xs">{b.last_activity_at ? timeAgo(b.last_activity_at) : <span className="text-muted-foreground">none recorded</span>}</Td>
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

export default function AdminBusinesses() {
  return <RequirePermission permission="businesses.read"><BusinessesDirectory /></RequirePermission>;
}

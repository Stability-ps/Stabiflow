import { Fragment, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ClipboardList } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AdminPageHeader, DataTable, EmptyNote, ErrorState, LoadingRows, Pager, RequirePermission, Section, Td, Th } from "@/components/admin/AdminPrimitives";
import { ExportButton } from "@/components/admin/ExportButton";
import { adminConsole, type AdminAuditRow, type Paged } from "@/lib/adminApi";
import { formatDateTime, humanize } from "@/lib/adminFormat";

const PAGE_SIZE = 50;
const TARGETS = ["all", "admin_role", "plan", "price", "plan_entitlement", "feature_flag", "platform_setting", "entitlement_override", "legal_document", "profile_template", "export"];

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  return <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-[11px]">{JSON.stringify(value, null, 2)}</pre>;
}

function AuditView() {
  const [params, setParams] = useSearchParams();
  const target = params.get("target") ?? "all";
  const page = Math.max(Number(params.get("page")) || 0, 0);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["admin-audit", target, page],
    queryFn: () => adminConsole<Paged<AdminAuditRow>>("audit", { target_type: target === "all" ? undefined : target, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <AdminPageHeader
        title="Audit log"
        description="Every staff change to pricing, plans, flags, settings, entitlements, legal pages and staff roles, plus every data export. Entries cannot be edited or deleted. Business suspensions appear on each business's page."
        actions={<ExportButton dataset="audit" />}
      />
      <Section title={q.data ? `${q.data.total.toLocaleString()} entries` : "Entries"}>
        <div className="space-y-4">
          <Select value={target} onValueChange={(v) => setParams(v === "all" ? {} : { target: v }, { replace: true })}>
            <SelectTrigger className="w-56" aria-label="Change type"><SelectValue /></SelectTrigger>
            <SelectContent>{TARGETS.map((t) => <SelectItem key={t} value={t}>{t === "all" ? "All changes" : humanize(t)}</SelectItem>)}</SelectContent>
          </Select>
          {q.isLoading ? <LoadingRows rows={10} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data!.rows.length === 0 ? (
            <EmptyNote icon={ClipboardList}>No staff changes recorded yet.</EmptyNote>
          ) : (
            <>
              <DataTable minWidth={760}>
                <thead><tr><Th className="w-6" /><Th>When</Th><Th>Staff member</Th><Th>Action</Th><Th>Target</Th><Th>Reason</Th></tr></thead>
                <tbody>
                  {q.data!.rows.map((a) => (
                    <Fragment key={a.id}>
                      <tr className="cursor-pointer hover:bg-accent/30" onClick={() => setOpen(open === a.id ? null : a.id)}>
                        <Td>
                          <button type="button" aria-expanded={open === a.id} aria-label="Show before and after" className="text-muted-foreground">
                            {open === a.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </Td>
                        <Td className="whitespace-nowrap text-xs">{formatDateTime(a.created_at)}</Td>
                        <Td className="text-xs">{a.profiles?.full_name ?? a.operator_user_id.slice(0, 8)}</Td>
                        <Td className="text-xs font-medium">{humanize(a.action)}</Td>
                        <Td className="text-xs">
                          {humanize(a.target_type)}{a.target_id ? <span className="text-muted-foreground"> · {a.target_id.length > 40 ? `${a.target_id.slice(0, 40)}…` : a.target_id}</span> : null}
                          {a.workspace_id ? <span className="block"><Link to={`/admin/businesses/${a.workspace_id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{a.workspaces?.name ?? "Business"}</Link></span> : null}
                        </Td>
                        <Td className="text-xs text-muted-foreground">{a.reason ?? "—"}</Td>
                      </tr>
                      {open === a.id ? (
                        <tr><td colSpan={6} className="border-b bg-muted/30 p-3">
                          <div className="grid gap-3 md:grid-cols-2">
                            <div><p className="mb-1 text-xs font-medium">Before</p><Json value={a.before_state} /></div>
                            <div><p className="mb-1 text-xs font-medium">After</p><Json value={a.after_state} /></div>
                          </div>
                        </td></tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </DataTable>
              <Pager page={page} pageSize={PAGE_SIZE} total={q.data!.total} onPage={(p) => { const n = new URLSearchParams(params); n.set("page", String(p)); setParams(n, { replace: true }); }} />
            </>
          )}
        </div>
      </Section>
    </>
  );
}

export default function AdminAudit() {
  return <RequirePermission permission="audit.read"><AuditView /></RequirePermission>;
}

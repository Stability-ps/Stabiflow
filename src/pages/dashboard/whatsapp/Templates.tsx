import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, FileText, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/EmptyState";
import { useInboxTemplates } from "@/hooks/useInboxTemplates";
import { filterWhatsAppTemplates, whatsappTemplateBody } from "@/pages/dashboard/whatsapp/templateFilters";
import { useWhatsAppOutlet } from "@/pages/dashboard/whatsapp/whatsappOutlet";

function statusTone(status: string): "default" | "secondary" | "outline" | "destructive" {
  const s = status.toUpperCase();
  if (s === "APPROVED") return "default";
  if (s === "REJECTED" || s === "DISABLED" || s === "PAUSED") return "destructive";
  if (s === "PENDING") return "outline";
  return "secondary";
}

const PAGE_SIZE = 50;

// Read-only manager for templates synced from Meta. StabiFlow deliberately
// does not submit provider templates in V1; creation/approval stays in Meta.
export default function WhatsAppTemplates() {
  const { workspaceId } = useWhatsAppOutlet();
  const { data: templates, isLoading } = useInboxTemplates(workspaceId);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);

  const categories = useMemo(
    () => Array.from(new Set((templates || []).map((t) => t.category || "Uncategorised"))).sort(),
    [templates],
  );
  const statuses = useMemo(
    () => Array.from(new Set((templates || []).map((t) => t.provider_status))).sort(),
    [templates],
  );

  const filtered = useMemo(
    () => filterWhatsAppTemplates(templates || [], query, category, status),
    [templates, query, category, status],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const approvedCount = (templates || []).filter((t) => t.provider_status.toUpperCase() === "APPROVED").length;
  const hasFilters = Boolean(query.trim()) || category !== "ALL" || status !== "ALL";

  function resetPage() {
    setPage(1);
  }

  if (isLoading) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  if (!templates || templates.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No templates synced yet"
        description="Message templates are created in Meta and synced into StabiFlow. Connect WhatsApp, or use Refresh under Settings, to pull them in."
        action={<Link to="/app/whatsapp/settings" className="text-sm font-medium underline underline-offset-2">Go to WhatsApp Settings</Link>}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{templates.length.toLocaleString()} synced template{templates.length === 1 ? "" : "s"}</p>
            <Badge variant="secondary" className="gap-1 font-normal">
              <CheckCircle2 className="h-3 w-3" />
              {approvedCount.toLocaleString()} approved
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Browse the templates synced from your Meta WhatsApp Business account.</p>
        </div>
        <Button asChild variant="outline" size="sm"><Link to="/app/whatsapp/settings">Refresh from Meta</Link></Button>
      </div>

      <div className="rounded-xl border bg-card p-3 shadow-sm">
        <div className="grid gap-2 lg:grid-cols-[minmax(320px,1fr)_200px_200px_auto]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); resetPage(); }}
            placeholder="Search name, language or message"
            className="pl-9"
            aria-label="Search templates"
          />
        </div>
        <select
          value={category}
          onChange={(e) => { setCategory(e.target.value); resetPage(); }}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Filter templates by category"
        >
          <option value="ALL">All categories</option>
          {categories.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); resetPage(); }}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Filter templates by status"
        >
          <option value="ALL">All statuses</option>
          {statuses.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        {hasFilters ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-10 gap-1.5 px-3 text-muted-foreground"
            onClick={() => { setQuery(""); setCategory("ALL"); setStatus("ALL"); setPage(1); }}
          >
            <X className="h-4 w-4" />
            Clear
          </Button>
        ) : <div />}
        </div>
        <div className="mt-2 flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
          <span>{filtered.length.toLocaleString()} of {templates.length.toLocaleString()} template{templates.length === 1 ? "" : "s"}</span>
          {pageCount > 1 && <span>Page {safePage.toLocaleString()} of {pageCount.toLocaleString()}</span>}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <caption className="sr-only">WhatsApp message templates</caption>
          <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Name</th>
              <th scope="col" className="px-4 py-2 font-medium">Language</th>
              <th scope="col" className="px-4 py-2 font-medium">Category</th>
              <th scope="col" className="px-4 py-2 font-medium">Status</th>
              <th scope="col" className="px-4 py-2 font-medium">Body</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => (
              <tr key={t.id} className="border-b last:border-b-0">
                <td className="px-4 py-2.5 font-medium"><span className="block max-w-[280px] truncate" title={t.name}>{t.name}</span></td>
                <td className="px-4 py-2.5 text-muted-foreground">{t.language}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{t.category || "—"}</td>
                <td className="px-4 py-2.5"><Badge variant={statusTone(t.provider_status)}>{t.provider_status}</Badge></td>
                <td className="max-w-md px-4 py-2.5 text-muted-foreground"><span className="line-clamp-2">{whatsappTemplateBody(t)}</span></td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No templates match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
          <Button variant="outline" size="sm" disabled={safePage >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Next</Button>
        </div>
      )}
    </div>
  );
}

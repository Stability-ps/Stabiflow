import { Search, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { qualificationStatusLabel } from "@/lib/qualification";
import type { LeadRow } from "@/hooks/useLeads";

export type LeadListFilter = "all" | "active" | "converted" | "lost";

const STATUS_TONE: Record<string, string> = {
  active: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  converted: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  lost: "bg-muted text-muted-foreground",
};

export function LeadList({ leads, onSelect, filter, onFilterChange, search, onSearchChange }: {
  leads: LeadRow[];
  onSelect: (id: string) => void;
  filter: LeadListFilter;
  onFilterChange: (filter: LeadListFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  const filtered = leads.filter((l) => {
    if (filter !== "all" && l.status !== filter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (![l.contact_name, l.phone, l.email, l.human_reference, l.company_name].some((v) => (v || "").toLowerCase().includes(q))) return false;
    }
    return true;
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-2 border-b p-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search leads" className="pl-8" />
        </div>
        <Select value={filter} onValueChange={(v) => onFilterChange(v as LeadListFilter)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All leads</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="converted">Converted</SelectItem>
            <SelectItem value="lost">Lost</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <EmptyState icon={Users} title="No leads yet" description="Leads from WhatsApp and other channels will appear here." className="border-none" />
        ) : (
          filtered.map((l) => (
            <button
              key={l.id}
              onClick={() => onSelect(l.id)}
              className="flex w-full items-center justify-between gap-3 border-b p-3 text-left text-sm transition-colors hover:bg-muted/50"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{l.contact_name || l.phone || l.human_reference}</p>
                <p className="truncate text-xs text-muted-foreground">{l.human_reference} - {l.source}</p>
              </div>
              <Badge variant="secondary" className="shrink-0">{qualificationStatusLabel(l.qualification_status)}</Badge>
              <Badge variant="secondary" className={`shrink-0 ${STATUS_TONE[l.status]}`}>{l.status}</Badge>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

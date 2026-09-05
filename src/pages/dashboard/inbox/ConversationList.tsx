import { useState } from "react";
import { Search, SlidersHorizontal, X, Inbox as InboxIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { inboxStatusLabel, priorityLabel } from "@/lib/inboxPresentation";
import type { InboxConversationRow, InboxConversationFilters } from "@/hooks/useInboxConversations";
import { EMPTY_INBOX_FILTERS } from "@/hooks/useInboxConversations";
import { computeSlaState, type SlaSettings } from "@/lib/slaState";

type StaffOption = { id: string; name: string };

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function statusTone(status: string): string {
  if (status === "resolved") return "bg-muted text-muted-foreground";
  if (status === "waiting_client") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
  if (status === "unassigned" || status === "new") return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
  return "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300";
}

function priorityTone(priority: string): string {
  if (priority === "urgent") return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
  if (priority === "high") return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
  return "";
}

const HANDLING_LABEL: Record<NonNullable<InboxConversationFilters["handling"]>, string> = {
  ai_active: "AI active",
  human_attention: "Human attention",
};
const ASSIGNMENT_LABEL: Record<NonNullable<InboxConversationFilters["assignment"]>, string> = {
  unassigned: "Unassigned",
  assigned: "Assigned",
  staff: "Specific person",
};

export function ConversationList({
  conversations,
  unreadIds,
  selectedId,
  onSelect,
  filters,
  onFiltersChange,
  searchInput,
  onSearchInputChange,
  staffOptions,
  slaSettings,
  hasNextPage,
  isFetchingNextPage,
  isFetching,
  filtersActive,
  onLoadMore,
}: {
  conversations: InboxConversationRow[];
  unreadIds: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  filters: InboxConversationFilters;
  onFiltersChange: (next: InboxConversationFilters) => void;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  staffOptions: StaffOption[];
  slaSettings?: SlaSettings | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetching: boolean;
  filtersActive: boolean;
  onLoadMore: () => void;
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const set = (patch: Partial<InboxConversationFilters>) => onFiltersChange({ ...filters, ...patch });
  const staffName = (id: string | null) => staffOptions.find((s) => s.id === id)?.name ?? "Member";

  const clearAll = () => {
    onSearchInputChange("");
    onFiltersChange(EMPTY_INBOX_FILTERS);
  };

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (filters.search.trim()) chips.push({ key: "search", label: `“${filters.search.trim()}”`, clear: () => { onSearchInputChange(""); set({ search: "" }); } });
  if (filters.inboxStatus) chips.push({ key: "inboxStatus", label: inboxStatusLabel(filters.inboxStatus), clear: () => set({ inboxStatus: null }) });
  if (filters.assignment) chips.push({ key: "assignment", label: filters.assignment === "staff" ? staffName(filters.assignedStaffId) : ASSIGNMENT_LABEL[filters.assignment], clear: () => set({ assignment: null, assignedStaffId: null }) });
  if (filters.priority) chips.push({ key: "priority", label: `${priorityLabel(filters.priority)} priority`, clear: () => set({ priority: null }) });
  if (filters.handling) chips.push({ key: "handling", label: HANDLING_LABEL[filters.handling], clear: () => set({ handling: null }) });
  if (filters.unreadOnly) chips.push({ key: "unread", label: "Unread", clear: () => set({ unreadOnly: false }) });

  return (
    <div className="flex h-full flex-col border-r">
      <div className="space-y-2 border-b p-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={searchInput} onChange={(e) => onSearchInputChange(e.target.value)} placeholder="Search name or number" className="pl-8" />
          </div>
          <Button
            type="button"
            variant={filtersActive ? "default" : "outline"}
            size="icon"
            aria-label="Filters"
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((v) => !v)}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
        </div>

        {panelOpen && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-2">
            <Select value={filters.inboxStatus ?? "all"} onValueChange={(v) => set({ inboxStatus: v === "all" ? null : (v as InboxConversationFilters["inboxStatus"]) })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Inbox status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="waiting_client">Waiting on client</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filters.assignment === "staff" ? `staff:${filters.assignedStaffId ?? ""}` : filters.assignment ?? "any"}
              onValueChange={(v) => {
                if (v === "any") set({ assignment: null, assignedStaffId: null });
                else if (v === "unassigned" || v === "assigned") set({ assignment: v, assignedStaffId: null });
                else if (v.startsWith("staff:")) set({ assignment: "staff", assignedStaffId: v.slice(6) || null });
              }}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Assigned to" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Anyone</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                <SelectItem value="assigned">Assigned (anyone)</SelectItem>
                {staffOptions.map((s) => (
                  <SelectItem key={s.id} value={`staff:${s.id}`}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.priority ?? "any"} onValueChange={(v) => set({ priority: v === "any" ? null : (v as InboxConversationFilters["priority"]) })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Priority" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any priority</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filters.handling ?? "any"} onValueChange={(v) => set({ handling: v === "any" ? null : (v as InboxConversationFilters["handling"]) })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Handling" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any handling</SelectItem>
                <SelectItem value="ai_active">AI active</SelectItem>
                <SelectItem value="human_attention">Human attention</SelectItem>
              </SelectContent>
            </Select>

            <label className="flex items-center gap-2 px-0.5 text-xs">
              <input type="checkbox" checked={filters.unreadOnly} onChange={(e) => set({ unreadOnly: e.target.checked })} />
              Unread only
            </label>
          </div>
        )}

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {chips.map((c) => (
              <button key={c.key} type="button" onClick={c.clear} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground hover:bg-secondary/80" aria-label={`Remove filter ${c.label}`}>
                {c.label} <X className="h-3 w-3" />
              </button>
            ))}
            <button type="button" onClick={clearAll} className="ml-1 text-xs text-muted-foreground underline hover:text-foreground">Clear all</button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto" role="list" aria-label="WhatsApp conversations">
        {conversations.length === 0 ? (
          filtersActive ? (
            <EmptyState
              icon={InboxIcon}
              title="No conversations match these filters"
              description="Try a different search or clear the filters."
              className="border-none"
              action={<Button variant="outline" size="sm" onClick={clearAll}>Clear filters</Button>}
            />
          ) : (
            <EmptyState
              icon={InboxIcon}
              title="Waiting for your first conversation"
              description="WhatsApp is connected. As soon as a customer messages your number, it will show up here."
              className="border-none"
            />
          )
        ) : (
          <>
            {conversations.map((c) => {
              const unread = unreadIds.has(c.id);
              const name = c.display_name || c.phone_number;
              return (
                <button
                  key={c.id}
                  role="listitem"
                  onClick={() => onSelect(c.id)}
                  aria-current={selectedId === c.id ? "true" : undefined}
                  aria-label={`Conversation with ${name}${unread ? ", unread" : ""}, ${inboxStatusLabel(c.inbox_status)}`}
                  className={`flex w-full items-start gap-3 border-b p-3 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selectedId === c.id ? "bg-muted" : ""}`}
                >
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarFallback className="text-xs">{(c.display_name || c.wa_id).slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`truncate text-sm ${unread ? "font-semibold" : "font-medium"}`}>{name}</p>
                      <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(c.last_inbound_at || c.updated_at)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <Badge variant="secondary" className={statusTone(c.inbox_status)}>{inboxStatusLabel(c.inbox_status)}</Badge>
                      {c.priority_level !== "normal" && <Badge variant="secondary" className={priorityTone(c.priority_level)}>{priorityLabel(c.priority_level)}</Badge>}
                      {computeSlaState(c, slaSettings).phase === "overdue" && (
                        <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">Overdue</Badge>
                      )}
                      {unread && <span className="h-2 w-2 rounded-full bg-primary" aria-label="Unread" />}
                    </div>
                  </div>
                </button>
              );
            })}
            <div className="p-3">
              {hasNextPage ? (
                <Button variant="outline" size="sm" className="w-full" onClick={onLoadMore} disabled={isFetchingNextPage}>
                  {isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              ) : (
                <p className="text-center text-xs text-muted-foreground">{isFetching ? "Refreshing…" : "End of list"}</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

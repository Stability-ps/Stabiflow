import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { Inbox as InboxIcon } from "lucide-react";
import { inboxStatusLabel, priorityLabel } from "@/lib/inboxPresentation";
import type { InboxConversationRow } from "@/hooks/useInboxConversations";

export type InboxFilter = "all" | "unassigned" | "assigned" | "waiting_client" | "resolved" | "unread";

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

export function ConversationList({ conversations, unreadIds, selectedId, onSelect, filter, onFilterChange, search, onSearchChange }: {
  conversations: InboxConversationRow[];
  unreadIds: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: InboxFilter;
  onFilterChange: (filter: InboxFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  const filtered = conversations.filter((c) => {
    if (filter === "unread" && !unreadIds.has(c.id)) return false;
    if (filter !== "all" && filter !== "unread" && c.inbox_status !== filter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!(c.display_name || "").toLowerCase().includes(q) && !c.wa_id.includes(q) && !c.phone_number.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="flex h-full flex-col border-r">
      <div className="space-y-2 border-b p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search conversations" className="pl-8" />
        </div>
        <Select value={filter} onValueChange={(v) => onFilterChange(v as InboxFilter)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All conversations</SelectItem>
            <SelectItem value="unread">Unread</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            <SelectItem value="assigned">Assigned</SelectItem>
            <SelectItem value="waiting_client">Waiting on client</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <EmptyState icon={InboxIcon} title="No conversations" description="Nothing matches this filter yet." className="border-none" />
        ) : (
          filtered.map((c) => {
            const unread = unreadIds.has(c.id);
            return (
              <button
                key={c.id}
                onClick={() => onSelect(c.id)}
                className={`flex w-full items-start gap-3 border-b p-3 text-left transition-colors hover:bg-muted/50 ${selectedId === c.id ? "bg-muted" : ""}`}
              >
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarFallback className="text-xs">{(c.display_name || c.wa_id).slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className={`truncate text-sm ${unread ? "font-semibold" : "font-medium"}`}>{c.display_name || c.phone_number}</p>
                    <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(c.last_inbound_at || c.updated_at)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <Badge variant="secondary" className={statusTone(c.inbox_status)}>{inboxStatusLabel(c.inbox_status)}</Badge>
                    {c.priority_level !== "normal" && <Badge variant="secondary" className={priorityTone(c.priority_level)}>{priorityLabel(c.priority_level)}</Badge>}
                    {unread && <span className="h-2 w-2 rounded-full bg-primary" aria-label="Unread" />}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

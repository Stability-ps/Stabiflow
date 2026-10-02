import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState } from "@/components/EmptyState";
import { useInboxConversations, type InboxConversationRow } from "@/hooks/useInboxConversations";
import { useWhatsAppOutlet } from "@/pages/dashboard/whatsapp/whatsappOutlet";

type ContactRow = {
  wa_id: string;
  phone_number: string;
  display_name: string | null;
  conversationCount: number;
  lastActivity: string | null;
  hasLead: boolean;
  latestConversationId: string;
};

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

function toContacts(conversations: InboxConversationRow[]): ContactRow[] {
  const byWaId = new Map<string, ContactRow>();
  for (const c of conversations) {
    const activity = c.last_inbound_at || c.updated_at;
    const existing = byWaId.get(c.wa_id);
    if (!existing) {
      byWaId.set(c.wa_id, {
        wa_id: c.wa_id,
        phone_number: c.phone_number,
        display_name: c.display_name,
        conversationCount: 1,
        lastActivity: activity,
        hasLead: !!c.lead_id,
        latestConversationId: c.id,
      });
      continue;
    }
    existing.conversationCount += 1;
    existing.hasLead = existing.hasLead || !!c.lead_id;
    if (!existing.display_name && c.display_name) existing.display_name = c.display_name;
    if (activity && (!existing.lastActivity || new Date(activity).getTime() > new Date(existing.lastActivity).getTime())) {
      existing.lastActivity = activity;
      existing.latestConversationId = c.id;
    }
  }
  return [...byWaId.values()].sort((a, b) => {
    const at = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
    const bt = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
    return bt - at;
  });
}

// A read-only roll-up of the people who have messaged this workspace's
// WhatsApp number, derived from inbox_conversations - it does not create,
// mutate, or re-fetch anything beyond the conversation list the Inbox
// already loads. Opening a contact deep-links into the Inbox.
export default function WhatsAppContacts() {
  const { workspaceId } = useWhatsAppOutlet();
  const navigate = useNavigate();
  const { data: conversations, isLoading } = useInboxConversations(workspaceId);
  const [search, setSearch] = useState("");

  const contacts = useMemo(() => toContacts(conversations || []), [conversations]);
  const visibleContacts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((contact) => [contact.display_name, contact.phone_number, contact.wa_id].some((value) => value?.toLowerCase().includes(q)));
  }, [contacts, search]);

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  }

  if (contacts.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No contacts yet"
        description="Contacts appear here automatically as customers message your WhatsApp number."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-semibold">WhatsApp contacts</h2><p className="text-sm text-muted-foreground">{contacts.length} contact{contacts.length === 1 ? "" : "s"} from your conversations</p></div>
        <div className="relative w-full sm:w-72"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search contacts" className="pl-8" /></div>
      </div>
      <div className="overflow-hidden rounded-lg border">
      {visibleContacts.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">No contacts match your search.</p> : <ul className="divide-y">
        {visibleContacts.map((contact) => {
          const name = contact.display_name || contact.phone_number;
          return (
            <li key={contact.wa_id}>
              <button
                type="button"
                onClick={() => navigate("/app/whatsapp/inbox", { state: { selectedId: contact.latestConversationId } })}
                className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                aria-label={`Open conversation with ${name}`}
              >
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarFallback className="text-xs">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{name}</p>
                    {contact.hasLead && <Badge variant="secondary">Lead</Badge>}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {contact.phone_number}
                    {contact.conversationCount > 1 ? ` · ${contact.conversationCount} conversations` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(contact.lastActivity)}</span>
              </button>
            </li>
          );
        })}
      </ul>}
      </div>
    </div>
  );
}

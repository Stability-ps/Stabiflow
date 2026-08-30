import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { useInboxConversationReads, useInboxConversations, isConversationUnread } from "@/hooks/useInboxConversations";
import { ConversationList, type InboxFilter } from "@/pages/dashboard/inbox/ConversationList";
import { ConversationDetail } from "@/pages/dashboard/inbox/ConversationDetail";
import { useWhatsAppOutlet } from "@/pages/dashboard/whatsapp/whatsappOutlet";

// The WhatsApp conversation dashboard - split view (list + detail). The
// parent WhatsAppLayout owns the permission and "is WhatsApp connected"
// gates and the connection-status header; this page assumes both are
// satisfied and focuses on the conversations themselves.
export default function WhatsAppInbox() {
  const { workspaceId, canManage } = useWhatsAppOutlet();
  const location = useLocation();
  // Contacts (and other in-app links) can deep-link to a specific
  // conversation via navigation state - honour it once on mount.
  const preselectId = (location.state as { selectedId?: string } | null)?.selectedId ?? null;

  const { data: conversations, isLoading: conversationsLoading } = useInboxConversations(workspaceId);
  const { data: reads } = useInboxConversationReads(workspaceId);

  const [selectedId, setSelectedId] = useState<string | null>(preselectId);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [search, setSearch] = useState("");
  const [mobileShowDetail, setMobileShowDetail] = useState(!!preselectId);

  useEffect(() => {
    if (preselectId) {
      setSelectedId(preselectId);
      setMobileShowDetail(true);
    }
    // Only react to a fresh navigation carrying a new id.
  }, [preselectId]);

  const unreadIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of conversations || []) {
      if (isConversationUnread(c, reads?.get(c.id))) ids.add(c.id);
    }
    return ids;
  }, [conversations, reads]);

  const selected = (conversations || []).find((c) => c.id === selectedId) || null;

  if (conversationsLoading) {
    return <div className="h-[60vh] animate-pulse rounded-lg bg-muted" />;
  }

  return (
    <div className="flex h-[calc(100vh-18rem)] min-h-[28rem] flex-col">
      <h2 className="sr-only">WhatsApp Inbox</h2>
      <div className="flex flex-1 overflow-hidden rounded-lg border">
        <div className={`w-full md:w-80 md:shrink-0 ${mobileShowDetail ? "hidden md:block" : "block"}`}>
          <ConversationList
            conversations={conversations || []}
            unreadIds={unreadIds}
            selectedId={selectedId}
            onSelect={(id) => { setSelectedId(id); setMobileShowDetail(true); }}
            filter={filter}
            onFilterChange={setFilter}
            search={search}
            onSearchChange={setSearch}
          />
        </div>
        <div className={`min-w-0 flex-1 ${mobileShowDetail ? "block" : "hidden md:block"}`}>
          {selected ? (
            <ConversationDetail
              workspaceId={workspaceId}
              conversation={selected}
              canManage={canManage}
              onBack={() => setMobileShowDetail(false)}
              onChanged={() => {}}
            />
          ) : (
            <EmptyState icon={MessageCircle} title="Select a conversation" description="Choose a conversation from the list to view and manage the chat." className="h-full border-none" />
          )}
        </div>
      </div>
    </div>
  );
}

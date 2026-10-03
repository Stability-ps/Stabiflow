import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import {
  EMPTY_INBOX_FILTERS,
  useInboxConversationsInfinite,
  type InboxConversationFilters,
} from "@/hooks/useInboxConversations";
import { ConversationList } from "@/pages/dashboard/inbox/ConversationList";
import { ConversationDetail } from "@/pages/dashboard/inbox/ConversationDetail";
import { useWhatsAppOutlet } from "@/pages/dashboard/whatsapp/whatsappOutlet";
import { useWorkspaceSlaSettings } from "@/hooks/useWorkspaceSlaSettings";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";

// The WhatsApp conversation dashboard - split view (list + detail). The
// parent WhatsAppLayout owns the permission and "is WhatsApp connected"
// gates and the connection-status header; this page assumes both are
// satisfied and focuses on the conversations themselves.
//
// Phase 14: the list is server-side searched / filtered / keyset-paginated
// (get_inbox_conversations RPC via useInboxConversationsInfinite). No more
// client-side `.filter()` over a capped 200 rows.
export default function WhatsAppInbox() {
  const { workspaceId, canManage } = useWhatsAppOutlet();
  const location = useLocation();
  const preselectId = (location.state as { selectedId?: string } | null)?.selectedId ?? null;

  const [filters, setFilters] = useState<InboxConversationFilters>(EMPTY_INBOX_FILTERS);
  const [searchInput, setSearchInput] = useState("");

  // Debounce the search box -> RPC param; a search change resets pagination
  // (new queryKey) without disturbing the selected conversation.
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.search === searchInput ? f : { ...f, search: searchInput }));
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const {
    conversations,
    isLoading: conversationsLoading,
    isFetching,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInboxConversationsInfinite(workspaceId, filters);
  const { data: slaSettings } = useWorkspaceSlaSettings(workspaceId);
  const { data: members } = useWorkspaceMembers(workspaceId);

  const staffOptions = useMemo(
    () =>
      (members ?? [])
        .map((m) => ({
          id: (m.profile as { id?: string } | null)?.id ?? m.user_id,
          name: (m.profile as { full_name?: string } | null)?.full_name ?? "Member",
        }))
        .filter((s) => !!s.id),
    [members],
  );

  const [selectedId, setSelectedId] = useState<string | null>(preselectId);
  const [mobileShowDetail, setMobileShowDetail] = useState(!!preselectId);

  useEffect(() => {
    if (preselectId) {
      setSelectedId(preselectId);
      setMobileShowDetail(true);
    }
  }, [preselectId]);

  const unreadIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of conversations) if (c.is_unread) ids.add(c.id);
    return ids;
  }, [conversations]);

  const selected = conversations.find((c) => c.id === selectedId) || null;

  if (conversationsLoading) {
    return <div className="h-[60vh] animate-pulse rounded-lg bg-muted" />;
  }

  const filtersActive = !!filters.search.trim() || !!filters.inboxStatus || !!filters.assignment || !!filters.priority || !!filters.handling || filters.unreadOnly;

  return (
    <div className="flex h-[calc(100vh-18rem)] min-h-[28rem] flex-col">
      <h2 className="sr-only">WhatsApp Inbox</h2>
      <div className="flex flex-1 overflow-hidden rounded-lg border">
        <div className={`w-full md:w-80 md:shrink-0 ${mobileShowDetail ? "hidden md:block" : "block"}`}>
          <ConversationList
            conversations={conversations}
            unreadIds={unreadIds}
            selectedId={selectedId}
            onSelect={(id) => { setSelectedId(id); setMobileShowDetail(true); }}
            filters={filters}
            onFiltersChange={setFilters}
            searchInput={searchInput}
            onSearchInputChange={setSearchInput}
            staffOptions={staffOptions}
            slaSettings={slaSettings}
            hasNextPage={!!hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            isFetching={isFetching}
            filtersActive={filtersActive}
            onLoadMore={() => fetchNextPage()}
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

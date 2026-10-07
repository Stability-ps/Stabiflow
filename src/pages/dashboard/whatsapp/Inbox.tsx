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
    return <div className="h-[calc(100dvh-14rem)] min-h-[28rem] animate-pulse rounded-xl bg-muted" role="status" aria-label="Loading conversations" />;
  }

  const filtersActive = !!filters.search.trim() || !!filters.inboxStatus || !!filters.assignment || !!filters.priority || !!filters.handling || filters.unreadOnly;

  return (
    // Fills the viewport below the shell header and Messages header (and the
    // bottom nav on phones) so the list and chat scroll internally, never
    // the page.
    <div className="flex h-[calc(100dvh-var(--header-height)-var(--bottom-nav-height)-env(safe-area-inset-top)-8.5rem)] min-h-[20rem] flex-col md:h-[calc(100dvh-var(--header-height)-11.75rem)] lg:h-[calc(100dvh-var(--header-height)-8.5rem)]">
      <h2 className="sr-only">WhatsApp Inbox</h2>
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card">
        {/* List + conversation side by side from lg; below that the list and
            the open conversation take turns (with a back button). */}
        <div className={`w-full border-border lg:w-[20.5rem] lg:shrink-0 lg:border-r ${mobileShowDetail ? "hidden lg:block" : "block"}`}>
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
        {/* Phones: an open conversation fills the screen between the app
            header and the bottom navigation, so the chat gets the room. */}
        <div
          className={`min-w-0 flex-1 ${
            mobileShowDetail
              ? "block max-md:fixed max-md:inset-x-0 max-md:bottom-[var(--bottom-nav-height)] max-md:top-[calc(var(--header-height)+env(safe-area-inset-top))] max-md:z-20 max-md:bg-card"
              : "hidden lg:block"
          }`}
        >
          {selected ? (
            <ConversationDetail
              workspaceId={workspaceId}
              conversation={selected}
              canManage={canManage}
              onBack={() => setMobileShowDetail(false)}
              onChanged={() => {}}
            />
          ) : (
            <EmptyState icon={MessageCircle} title="Select a conversation" description="Choose a conversation from the list to view and manage the chat." className="h-full bg-background/40" />
          )}
        </div>
      </div>
    </div>
  );
}

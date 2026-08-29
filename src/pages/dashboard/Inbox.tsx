import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Inbox as InboxIcon, MessageCircle } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { roleHasPermission } from "@/lib/permissions";
import { useWorkspaceIntegrations } from "@/hooks/useIntegrations";
import { useInboxConversationReads, useInboxConversations, isConversationUnread } from "@/hooks/useInboxConversations";
import { ConversationList, type InboxFilter } from "@/pages/dashboard/inbox/ConversationList";
import { ConversationDetail } from "@/pages/dashboard/inbox/ConversationDetail";

export default function Inbox() {
  const navigate = useNavigate();
  const { currentWorkspaceId, currentMembership } = useAuth();
  const role = currentMembership?.role;
  const canView = roleHasPermission(role, "inbox.view");
  const canManage = roleHasPermission(role, "inbox.manage");

  const { data: integrations, isLoading: integrationsLoading } = useWorkspaceIntegrations(currentWorkspaceId);
  const { data: conversations, isLoading: conversationsLoading } = useInboxConversations(canView ? currentWorkspaceId : null);
  const { data: reads } = useInboxConversationReads(canView ? currentWorkspaceId : null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [search, setSearch] = useState("");
  const [mobileShowDetail, setMobileShowDetail] = useState(false);

  const unreadIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of conversations || []) {
      if (isConversationUnread(c, reads?.get(c.id))) ids.add(c.id);
    }
    return ids;
  }, [conversations, reads]);

  const selected = (conversations || []).find((c) => c.id === selectedId) || null;
  const whatsappConnected = (integrations || []).some((i) => i.provider === "whatsapp" && i.status === "connected");

  if (!currentWorkspaceId || integrationsLoading || conversationsLoading) {
    return <div className="h-[70vh] animate-pulse rounded-lg bg-muted" />;
  }

  if (!canView) {
    return <EmptyState icon={InboxIcon} title="Inbox" description="You don't have permission to view this workspace's conversations. Ask a workspace owner or admin." />;
  }

  if (!whatsappConnected) {
    return (
      <EmptyState
        icon={InboxIcon}
        title="No WhatsApp number connected"
        description="Connect a WhatsApp Business number under Integrations to start receiving conversations here."
        action={<Button variant="outline" onClick={() => navigate("/app/integrations")}>Go to Integrations</Button>}
      />
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Inbox</h1>
        <p className="text-sm text-muted-foreground">WhatsApp conversations, AI-assisted replies, and human takeover.</p>
      </div>

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
              workspaceId={currentWorkspaceId}
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

import { useEffect, useMemo } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type InboxConversationRow = {
  id: string;
  wa_id: string;
  phone_number: string;
  display_name: string | null;
  status: "active" | "human_handoff" | "closed";
  ai_enabled: boolean;
  inbox_status: "new" | "unassigned" | "assigned" | "waiting_client" | "resolved";
  priority_level: "normal" | "high" | "urgent";
  assigned_staff_id: string | null;
  assigned_staff_name: string | null;
  ai_summary: string | null;
  intake_missing_fields: string[];
  intake_payload: Record<string, unknown>;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  updated_at: string;
  lead_id: string | null;
  intake_schema_id: string | null;
  intake_completed_at: string | null;
  customer_id: string | null;
  human_handoff_requested_at: string | null;
  last_staff_reply_at: string | null;
  /** Phase 14: caller-specific. Server-computed by get_inbox_conversations;
   * the legacy list query (Overview / Contacts) leaves it false. */
  is_unread: boolean;
};

const CONVERSATION_COLUMNS =
  "id, wa_id, phone_number, display_name, status, ai_enabled, inbox_status, priority_level, assigned_staff_id, assigned_staff_name, ai_summary, intake_missing_fields, intake_payload, last_inbound_at, last_outbound_at, updated_at, lead_id, intake_schema_id, intake_completed_at, customer_id, human_handoff_requested_at, last_staff_reply_at";

/**
 * Legacy list query - a single `updated_at desc` page capped at 200 rows.
 * Still used by non-operational summary surfaces (Dashboard overview,
 * WhatsApp Contacts) that derive an at-a-glance list, NOT by the Inbox
 * split view (which uses useInboxConversationsInfinite below). `is_unread`
 * is always false here - those surfaces don't render read state.
 */
export function useInboxConversations(workspaceId: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["inbox-conversations", workspaceId],
    queryFn: async (): Promise<InboxConversationRow[]> => {
      const { data, error } = await supabase
        .from("inbox_conversations")
        .select(CONVERSATION_COLUMNS)
        .eq("workspace_id", workspaceId as string)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data as Omit<InboxConversationRow, "is_unread">[]).map((r) => ({ ...r, is_unread: false }));
    },
    enabled: !!workspaceId,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!workspaceId) return;
    const channel = supabase
      .channel(`inbox-conversations-${workspaceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "inbox_conversations", filter: `workspace_id=eq.${workspaceId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["inbox-conversations", workspaceId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "inbox_alerts", filter: `workspace_id=eq.${workspaceId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["inbox-conversations", workspaceId] });
        queryClient.invalidateQueries({ queryKey: ["inbox-alerts", workspaceId] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId, queryClient]);

  return query;
}

// --------------------------------------------------------------------------
// Phase 14 - server-side search / filter / keyset pagination.
// --------------------------------------------------------------------------

export type InboxConversationFilters = {
  search: string;
  inboxStatus: "unassigned" | "assigned" | "waiting_client" | "resolved" | null;
  assignment: "unassigned" | "assigned" | "staff" | null;
  assignedStaffId: string | null;
  priority: "normal" | "high" | "urgent" | null;
  handling: "ai_active" | "human_attention" | null;
  unreadOnly: boolean;
};

export const EMPTY_INBOX_FILTERS: InboxConversationFilters = {
  search: "",
  inboxStatus: null,
  assignment: null,
  assignedStaffId: null,
  priority: null,
  handling: null,
  unreadOnly: false,
};

export function activeInboxFilterCount(f: InboxConversationFilters): number {
  let n = 0;
  if (f.search.trim()) n += 1;
  if (f.inboxStatus) n += 1;
  if (f.assignment) n += 1;
  if (f.priority) n += 1;
  if (f.handling) n += 1;
  if (f.unreadOnly) n += 1;
  return n;
}

export const INBOX_PAGE_SIZE = 50;

type Cursor = { updated_at: string; id: string };

/** Opaque enough for the UI; keyset walk over (updated_at DESC, id DESC). */
function nextCursor(page: InboxConversationRow[]): Cursor | undefined {
  if (page.length < INBOX_PAGE_SIZE) return undefined;
  const last = page[page.length - 1];
  return { updated_at: last.updated_at, id: last.id };
}

/** JSON-stable key fragment so a filter change is a distinct cache entry. */
function filtersKey(f: InboxConversationFilters): string {
  return JSON.stringify([
    f.search.trim().toLowerCase(),
    f.inboxStatus,
    f.assignment,
    f.assignment === "staff" ? f.assignedStaffId : null,
    f.priority,
    f.handling,
    f.unreadOnly,
  ]);
}

export function useInboxConversationsInfinite(workspaceId: string | null, filters: InboxConversationFilters) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const key = filtersKey(filters);

  const infinite = useInfiniteQuery({
    queryKey: ["inbox-conversations-paged", workspaceId, key],
    enabled: !!workspaceId,
    initialPageParam: null as Cursor | null,
    refetchInterval: 30_000,
    queryFn: async ({ pageParam }): Promise<InboxConversationRow[]> => {
      const cursor = pageParam as Cursor | null;
      const { data, error } = await supabase.rpc("get_inbox_conversations", {
        p_workspace_id: workspaceId as string,
        p_limit: INBOX_PAGE_SIZE,
        p_cursor_updated_at: cursor?.updated_at ?? undefined,
        p_cursor_id: cursor?.id ?? undefined,
        p_search: filters.search.trim() || undefined,
        p_inbox_status: filters.inboxStatus ?? undefined,
        p_assignment: filters.assignment ?? undefined,
        p_assigned_staff_id: filters.assignment === "staff" ? filters.assignedStaffId ?? undefined : undefined,
        p_priority: filters.priority ?? undefined,
        p_handling: filters.handling ?? undefined,
        p_unread_only: filters.unreadOnly || undefined,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as InboxConversationRow[];
    },
    getNextPageParam: (lastPage) => nextCursor(lastPage) ?? undefined,
  });

  // One workspace-scoped realtime channel (unchanged shape). A relevant
  // change invalidates the infinite query; React Query v5 refetches each
  // loaded page in order, recomputing the cursor between pages, so loaded
  // depth and scroll are preserved (it never collapses to page 1).
  useEffect(() => {
    if (!workspaceId) return;
    const channel = supabase.channel(`inbox-conversations-paged-${workspaceId}`);
    channel
      .on("postgres_changes", { event: "*", schema: "public", table: "inbox_conversations", filter: `workspace_id=eq.${workspaceId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["inbox-conversations-paged", workspaceId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "inbox_alerts", filter: `workspace_id=eq.${workspaceId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["inbox-alerts", workspaceId] });
      });
    if (user?.id) {
      // Phase 14: read-state is now server-computed (is_unread), so a
      // mark-read must refresh the list. Scoped to THIS staff member.
      channel.on("postgres_changes", { event: "*", schema: "public", table: "inbox_conversation_reads", filter: `staff_id=eq.${user.id}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["inbox-conversations-paged", workspaceId] });
      });
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId, user?.id, queryClient]);

  const conversations = useMemo(
    () => (infinite.data?.pages ?? []).flat(),
    [infinite.data],
  );

  return { ...infinite, conversations };
}

/** @deprecated Phase 14 moved unread server-side (row.is_unread). Kept for
 * any external caller; the Inbox no longer uses it. */
export function useInboxConversationReads(workspaceId: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["inbox-conversation-reads", workspaceId, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("inbox_conversation_reads").select("conversation_id, last_read_at").eq("staff_id", user!.id);
      if (error) throw new Error(error.message);
      return new Map((data || []).map((row) => [row.conversation_id, row.last_read_at as string]));
    },
    enabled: !!workspaceId && !!user?.id,
  });
}

export function isConversationUnread(conversation: InboxConversationRow, lastReadAt: string | undefined): boolean {
  if (!conversation.last_inbound_at) return false;
  if (!lastReadAt) return true;
  return new Date(conversation.last_inbound_at).getTime() > new Date(lastReadAt).getTime();
}

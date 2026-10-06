// Shared-inbox quick views, expressed purely as the existing server-side
// filters (search_inbox_conversations) so they cost nothing new and stay
// consistent with the advanced filter panel.
import type { InboxConversationFilters } from "@/hooks/useInboxConversations";

export type QuickViewKey = "all" | "mine" | "unassigned" | "ai" | "needs_human" | "closed";

type Patch = Pick<InboxConversationFilters, "assignment" | "assignedStaffId" | "handling" | "inboxStatus">;

export const QUICK_VIEWS: { key: QuickViewKey; label: string; title: string; patch: (me: string | null) => Patch }[] = [
  { key: "all", label: "All", title: "Every conversation", patch: () => ({ assignment: null, assignedStaffId: null, handling: null, inboxStatus: null }) },
  { key: "mine", label: "Mine", title: "Assigned to you", patch: (me) => ({ assignment: "staff", assignedStaffId: me, handling: null, inboxStatus: null }) },
  { key: "unassigned", label: "Unassigned", title: "Nobody owns these yet", patch: () => ({ assignment: "unassigned", assignedStaffId: null, handling: null, inboxStatus: null }) },
  { key: "ai", label: "AI handling", title: "AI and automations are replying", patch: () => ({ assignment: null, assignedStaffId: null, handling: "ai_active", inboxStatus: null }) },
  { key: "needs_human", label: "Needs human", title: "Handed to the team and not yet taken over", patch: () => ({ assignment: "unassigned", assignedStaffId: null, handling: "human_attention", inboxStatus: null }) },
  { key: "closed", label: "Closed", title: "Resolved conversations", patch: () => ({ assignment: null, assignedStaffId: null, handling: null, inboxStatus: "resolved" }) },
];

export function activeQuickView(f: InboxConversationFilters, me: string | null): QuickViewKey | null {
  for (const v of QUICK_VIEWS) {
    const p = v.patch(me);
    if (f.assignment === p.assignment && f.assignedStaffId === p.assignedStaffId && f.handling === p.handling && f.inboxStatus === p.inboxStatus) return v.key;
  }
  return null;
}

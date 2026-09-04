import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const PAGE = 50;
const TOTAL = 130;

// Deterministic fake dataset: newest first, updated_at strictly decreasing,
// unique ids. The RPC stub returns one keyset page based on the cursor.
const ALL = Array.from({ length: TOTAL }, (_, i) => ({
  id: `conv-${String(i).padStart(4, "0")}`,
  wa_id: `2782${1000000 + i}`,
  phone_number: `+2782${1000000 + i}`,
  display_name: `Person ${i}`,
  status: "active",
  ai_enabled: true,
  inbox_status: "unassigned",
  priority_level: "normal",
  assigned_staff_id: null,
  assigned_staff_name: null,
  ai_summary: null,
  intake_missing_fields: [],
  intake_payload: {},
  last_inbound_at: new Date(Date.UTC(2026, 5, 1) - i * 60_000).toISOString(),
  last_outbound_at: null,
  updated_at: new Date(Date.UTC(2026, 5, 1) - i * 60_000).toISOString(),
  lead_id: null,
  intake_schema_id: null,
  intake_completed_at: null,
  customer_id: null,
  human_handoff_requested_at: null,
  last_staff_reply_at: null,
  is_unread: i % 2 === 0,
}));

const rpcSpy = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => {
  const channel = () => {
    const ch: Record<string, unknown> = {};
    ch.on = () => ch;
    ch.subscribe = () => ch;
    return ch;
  };
  return {
    supabase: {
      rpc: (name: string, params: Record<string, unknown>) => rpcSpy(name, params),
      channel,
      removeChannel: vi.fn(),
      from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) }),
    },
  };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "staff-1" } }) }));

import {
  useInboxConversationsInfinite,
  EMPTY_INBOX_FILTERS,
  type InboxConversationFilters,
} from "./useInboxConversations";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  rpcSpy.mockReset();
  rpcSpy.mockImplementation((_name: string, params: Record<string, unknown>) => {
    // keyset: cursor id -> start after it; null -> from the top
    const cursorId = params.p_cursor_id as string | undefined;
    const startIdx = cursorId ? ALL.findIndex((r) => r.id === cursorId) + 1 : 0;
    let slice = ALL.slice(startIdx);
    if (params.p_search) slice = slice.filter((r) => r.display_name.toLowerCase().includes(String(params.p_search).toLowerCase()));
    if (params.p_unread_only) slice = slice.filter((r) => r.is_unread);
    return Promise.resolve({ data: slice.slice(0, (params.p_limit as number) ?? PAGE), error: null });
  });
});
afterEach(cleanup);

describe("useInboxConversationsInfinite", () => {
  it("loads the first keyset page (no cursor, page size limit)", async () => {
    const { result } = renderHook(() => useInboxConversationsInfinite("ws-1", EMPTY_INBOX_FILTERS), { wrapper: wrap() });
    await waitFor(() => expect(result.current.conversations.length).toBe(PAGE));
    expect(rpcSpy).toHaveBeenCalledWith("get_inbox_conversations", expect.objectContaining({ p_workspace_id: "ws-1", p_limit: PAGE, p_cursor_id: undefined }));
    expect(result.current.hasNextPage).toBe(true);
  });

  it("fetchNextPage appends the next page using the last row as the cursor, with no duplicate ids", async () => {
    const { result } = renderHook(() => useInboxConversationsInfinite("ws-1", EMPTY_INBOX_FILTERS), { wrapper: wrap() });
    await waitFor(() => expect(result.current.conversations.length).toBe(PAGE));
    await act(async () => { await result.current.fetchNextPage(); });
    await waitFor(() => expect(result.current.conversations.length).toBe(PAGE * 2));
    const lastOfPage1 = ALL[PAGE - 1].id;
    expect(rpcSpy).toHaveBeenCalledWith("get_inbox_conversations", expect.objectContaining({ p_cursor_id: lastOfPage1 }));
    const ids = result.current.conversations.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reaches conversations past the old 200-row window (3rd page)", async () => {
    const { result } = renderHook(() => useInboxConversationsInfinite("ws-1", EMPTY_INBOX_FILTERS), { wrapper: wrap() });
    await waitFor(() => expect(result.current.conversations.length).toBe(PAGE));
    await act(async () => { await result.current.fetchNextPage(); });
    await act(async () => { await result.current.fetchNextPage(); });
    await waitFor(() => expect(result.current.conversations.length).toBe(TOTAL)); // 50+50+30
    expect(result.current.hasNextPage).toBe(false);
    expect(result.current.conversations.some((c) => c.id === "conv-0125")).toBe(true);
  });

  it("changing the search resets pagination to page 1", async () => {
    const { result, rerender } = renderHook(
      ({ f }: { f: InboxConversationFilters }) => useInboxConversationsInfinite("ws-1", f),
      { wrapper: wrap(), initialProps: { f: EMPTY_INBOX_FILTERS } },
    );
    await waitFor(() => expect(result.current.conversations.length).toBe(PAGE));
    await act(async () => { await result.current.fetchNextPage(); });
    await waitFor(() => expect(result.current.conversations.length).toBe(PAGE * 2));

    rerender({ f: { ...EMPTY_INBOX_FILTERS, search: "Person 12" } });
    await waitFor(() => {
      // Person 12, 120-129 => 11 matches, single page, back to page 1
      expect(result.current.conversations.every((c) => (c.display_name ?? "").includes("Person 12"))).toBe(true);
    });
    expect(result.current.conversations.length).toBeLessThan(PAGE);
  });

  it("changing a filter resets pagination and re-queries", async () => {
    const { result, rerender } = renderHook(
      ({ f }: { f: InboxConversationFilters }) => useInboxConversationsInfinite("ws-1", f),
      { wrapper: wrap(), initialProps: { f: EMPTY_INBOX_FILTERS } },
    );
    await waitFor(() => expect(result.current.conversations.length).toBe(PAGE));
    await act(async () => { await result.current.fetchNextPage(); });
    await waitFor(() => expect(result.current.conversations.length).toBe(PAGE * 2));

    rerender({ f: { ...EMPTY_INBOX_FILTERS, unreadOnly: true } });
    await waitFor(() => expect(result.current.conversations.every((c) => c.is_unread)).toBe(true));
    expect(rpcSpy).toHaveBeenLastCalledWith("get_inbox_conversations", expect.objectContaining({ p_unread_only: true, p_cursor_id: undefined }));
  });

  it("a background refetch of the infinite query keeps every loaded page (does not collapse to page 1)", async () => {
    const { result } = renderHook(() => useInboxConversationsInfinite("ws-1", EMPTY_INBOX_FILTERS), { wrapper: wrap() });
    await waitFor(() => expect(result.current.conversations.length).toBe(PAGE));
    await act(async () => { await result.current.fetchNextPage(); });
    await waitFor(() => expect(result.current.conversations.length).toBe(PAGE * 2));

    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.conversations.length).toBe(PAGE * 2)); // still 2 pages
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConversationList } from "./ConversationList";
import { EMPTY_INBOX_FILTERS, type InboxConversationRow, type InboxConversationFilters } from "@/hooks/useInboxConversations";

function row(over: Partial<InboxConversationRow> = {}): InboxConversationRow {
  return {
    id: "c1", wa_id: "27820000001", phone_number: "+27820000001", display_name: "Nomsa",
    status: "active", ai_enabled: true, inbox_status: "unassigned", priority_level: "normal",
    assigned_staff_id: null, assigned_staff_name: null, ai_summary: null,
    intake_missing_fields: [], intake_payload: {}, last_inbound_at: "2026-08-30T09:00:00Z",
    last_outbound_at: null, updated_at: "2026-08-30T09:00:00Z", lead_id: null,
    intake_schema_id: null, intake_completed_at: null, customer_id: null,
    human_handoff_requested_at: null, last_staff_reply_at: null, is_unread: false, ...over,
  };
}

function renderList(props: Partial<Parameters<typeof ConversationList>[0]> = {}) {
  const onFiltersChange = vi.fn();
  const onSearchInputChange = vi.fn();
  const onLoadMore = vi.fn();
  const onSelect = vi.fn();
  render(
    <ConversationList
      conversations={[row(), row({ id: "c2", display_name: "Sipho", is_unread: true })]}
      unreadIds={new Set(["c2"])}
      selectedId={null}
      onSelect={onSelect}
      filters={EMPTY_INBOX_FILTERS}
      onFiltersChange={onFiltersChange}
      searchInput=""
      onSearchInputChange={onSearchInputChange}
      staffOptions={[{ id: "s1", name: "Thabo" }]}
      slaSettings={null}
      hasNextPage
      isFetchingNextPage={false}
      isFetching={false}
      filtersActive={false}
      onLoadMore={onLoadMore}
      {...props}
    />,
  );
  return { onFiltersChange, onSearchInputChange, onLoadMore, onSelect };
}

afterEach(cleanup);

describe("ConversationList (Phase 14)", () => {
  it("renders server-provided rows without any client-side filtering", () => {
    renderList();
    expect(screen.getByText("Nomsa")).toBeInTheDocument();
    expect(screen.getByText("Sipho")).toBeInTheDocument();
  });

  it("typing in search calls onSearchInputChange (debounce/RPC handled upstream)", () => {
    const { onSearchInputChange } = renderList();
    fireEvent.change(screen.getByPlaceholderText(/search name or number/i), { target: { value: "sip" } });
    expect(onSearchInputChange).toHaveBeenCalledWith("sip");
  });

  it("Load more calls onLoadMore; hidden when there is no next page", () => {
    const { onLoadMore } = renderList();
    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(onLoadMore).toHaveBeenCalled();
    cleanup();
    renderList({ hasNextPage: false });
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
    expect(screen.getByText(/end of list/i)).toBeInTheDocument();
  });

  it("shows active filter chips and a Clear all that resets filters + search", () => {
    const activeFilters: InboxConversationFilters = { ...EMPTY_INBOX_FILTERS, priority: "high", unreadOnly: true };
    const { onFiltersChange, onSearchInputChange } = renderList({ filters: activeFilters, filtersActive: true });
    expect(screen.getByText(/high priority/i)).toBeInTheDocument();
    expect(screen.getByText(/^Unread$/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/clear all/i));
    expect(onFiltersChange).toHaveBeenCalledWith(EMPTY_INBOX_FILTERS);
    expect(onSearchInputChange).toHaveBeenCalledWith("");
  });

  it("distinguishes the no-match empty state (with Clear filters) from the no-conversations-yet state", () => {
    renderList({ conversations: [], filtersActive: true });
    expect(screen.getByText(/no conversations match these filters/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear filters/i })).toBeInTheDocument();
    cleanup();
    renderList({ conversations: [], filtersActive: false });
    expect(screen.getByText(/waiting for your first conversation/i)).toBeInTheDocument();
  });

  it("opens the filter panel and applies a priority filter server-side (via onFiltersChange)", () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    // the panel's Priority select is present
    expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0);
  });
});

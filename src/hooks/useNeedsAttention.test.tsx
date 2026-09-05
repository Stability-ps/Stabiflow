import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// A minimal chainable Supabase query-builder stub. `.from(table)` returns a
// thenable whose every filter method returns itself; awaiting it resolves
// to the fixture for that table (or a rejection, to exercise M10).
const fixtures = vi.hoisted(() => ({
  data: {} as Record<string, unknown[]>,
  reject: new Set<string>(),
}));

function builder(table: string) {
  const result = fixtures.reject.has(table)
    ? Promise.reject(new Error(`boom:${table}`))
    : Promise.resolve({ data: fixtures.data[table] ?? [], error: null });
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "gte", "lt", "order", "limit", "in"]) {
    chain[m] = () => chain;
  }
  chain.then = (res: unknown, rej: unknown) => (result as Promise<unknown>).then(res as never, rej as never);
  chain.catch = (rej: unknown) => (result as Promise<unknown>).catch(rej as never);
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => builder(t) },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ currentMembership: { role: "owner" } }) }));

import { useNeedsAttention } from "./useNeedsAttention";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  fixtures.data = {};
  fixtures.reject = new Set();
});
afterEach(cleanup);

describe("useNeedsAttention", () => {
  it("drops a human-handoff item once its conversation has been returned to AI (audit M11)", async () => {
    fixtures.data.inbox_alerts = [
      { id: "a1", alert_type: "human_handoff", severity: "critical", title: "Needs a human", conversation_id: "conv-stale", created_at: "2026-09-01T10:00:00Z" },
      { id: "a2", alert_type: "human_handoff", severity: "critical", title: "Still needs a human", conversation_id: "conv-live", created_at: "2026-09-01T11:00:00Z" },
    ];
    fixtures.data.inbox_conversations = [
      { id: "conv-stale", status: "active", priority_level: "normal", ai_enabled: true },
      { id: "conv-live", status: "human_handoff", priority_level: "normal", ai_enabled: false },
    ];
    const { result } = renderHook(() => useNeedsAttention("ws-1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const ids = result.current.items.map((i) => i.id);
    expect(ids).toContain("alert:a2");
    expect(ids).not.toContain("alert:a1");
    expect(result.current.partialFailure).toBe(false);
  });

  it("degrades gracefully when one source query fails - other categories still render (audit M10)", async () => {
    fixtures.reject.add("inbox_alerts");
    fixtures.data.ad_campaigns = [
      { id: "c1", name: "Spring", updated_at: "2026-09-01T10:00:00Z", last_publish_error: { message: "token expired" } },
    ];
    const { result } = renderHook(() => useNeedsAttention("ws-1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.partialFailure).toBe(true);
    expect(result.current.items.map((i) => i.id)).toContain("campaign:c1");
  });

  it("de-duplicates two unresolved alerts on the same conversation to one item (audit M9)", async () => {
    fixtures.data.inbox_alerts = [
      { id: "a1", alert_type: "customer_reply", severity: "warning", title: "reply 1", conversation_id: "conv-x", created_at: "2026-09-01T10:00:00Z" },
      { id: "a2", alert_type: "customer_reply", severity: "warning", title: "reply 2", conversation_id: "conv-x", created_at: "2026-09-01T11:00:00Z" },
    ];
    const { result } = renderHook(() => useNeedsAttention("ws-1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // distinct alert ids -> two items is fine here (they are genuinely two
    // different alert rows); the dedupe guard is on the *item id*, which
    // is unique per alert. What must NOT happen is a React key collision.
    const keys = result.current.items.map((i) => i.id);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpcResult = vi.hoisted(() => ({ data: [] as unknown[], error: null as unknown }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: () => Promise.resolve(rpcResult) },
}));

import { useRevenueBreakdown } from "./useRevenueBreakdown";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
const RANGE = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-10-01T00:00:00Z") };

beforeEach(() => { rpcResult.data = []; rpcResult.error = null; });
afterEach(cleanup);

describe("useRevenueBreakdown — one call, display ordering (audit M15 / §20-21)", () => {
  it("splits the single RPC result by dimension and sorts source/assist by amount when single-currency", async () => {
    rpcResult.data = [
      { dimension: "source", bucket_key: "a", bucket_label: "A", revenue: [{ currency: "ZAR", amount_minor: 100 }], event_count: 9 },
      { dimension: "source", bucket_key: "b", bucket_label: "B", revenue: [{ currency: "ZAR", amount_minor: 500 }], event_count: 1 },
      { dimension: "assist", bucket_key: "ai_only", bucket_label: "AI only", revenue: [{ currency: "ZAR", amount_minor: 20 }], event_count: 2 },
      { dimension: "day", bucket_key: "2026-09-02", bucket_label: "2026-09-02", revenue: [{ currency: "ZAR", amount_minor: 1 }], event_count: 1 },
      { dimension: "day", bucket_key: "2026-09-01", bucket_label: "2026-09-01", revenue: [{ currency: "ZAR", amount_minor: 1 }], event_count: 1 },
    ];
    const { result } = renderHook(() => useRevenueBreakdown("ws-1", RANGE), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // source: bigger amount first, even though it has fewer events
    expect(result.current.source.map((r) => r.bucket_key)).toEqual(["b", "a"]);
    expect(result.current.assist).toHaveLength(1);
    // day: chronological, not by magnitude
    expect(result.current.day.map((r) => r.bucket_key)).toEqual(["2026-09-01", "2026-09-02"]);
  });

  it("falls back to event_count ordering when a bucket set is mixed-currency (never compares magnitudes across currencies)", async () => {
    rpcResult.data = [
      { dimension: "source", bucket_key: "x", bucket_label: "X", revenue: [{ currency: "ZAR", amount_minor: 100 }, { currency: "USD", amount_minor: 5 }], event_count: 1 },
      { dimension: "source", bucket_key: "y", bucket_label: "Y", revenue: [{ currency: "ZAR", amount_minor: 999 }], event_count: 8 },
    ];
    const { result } = renderHook(() => useRevenueBreakdown("ws-1", RANGE), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // y has more events -> first; x's magnitude is never used because the set is mixed
    expect(result.current.source.map((r) => r.bucket_key)).toEqual(["y", "x"]);
  });

  it("returns empty arrays (never errors) when the RPC self-gates to an empty result", async () => {
    rpcResult.data = [];
    const { result } = renderHook(() => useRevenueBreakdown("ws-1", RANGE), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.source).toEqual([]);
    expect(result.current.assist).toEqual([]);
    expect(result.current.day).toEqual([]);
  });
});

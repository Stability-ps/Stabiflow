import { describe, expect, it } from "vitest";
import { dedupeNeedsAttention, sortNeedsAttention, summarize, severityTone, type NeedsAttentionItem } from "./needsAttention";

function item(overrides: Partial<NeedsAttentionItem> = {}): NeedsAttentionItem {
  return {
    id: "alert:1",
    kind: "customer_reply",
    severity: "warning",
    title: "T",
    description: "D",
    occurredAt: "2026-09-01T10:00:00Z",
    targetType: "conversation",
    targetId: "1",
    actionPath: "/app/whatsapp/inbox",
    actionLabel: "Open conversation",
    canAct: true,
    ...overrides,
  };
}

describe("sortNeedsAttention", () => {
  it("orders by severity, then most recent, with null timestamps last", () => {
    const sorted = sortNeedsAttention([
      item({ id: "a", severity: "warning", occurredAt: "2026-09-01T12:00:00Z" }),
      item({ id: "b", severity: "critical", occurredAt: null }),
      item({ id: "c", severity: "critical", occurredAt: "2026-09-01T11:00:00Z" }),
      item({ id: "d", severity: "info", occurredAt: "2026-09-01T13:00:00Z" }),
    ]);
    // critical first (c before b because b has no timestamp), then warning, then info
    expect(sorted.map((i) => i.id)).toEqual(["c", "b", "a", "d"]);
  });

  it("does not mutate the input", () => {
    const input = [item({ id: "a" }), item({ id: "b", severity: "critical" })];
    sortNeedsAttention(input);
    expect(input.map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("dedupeNeedsAttention (audit M9)", () => {
  it("collapses items with the same id, keeping the most recent occurrence", () => {
    const out = dedupeNeedsAttention([
      item({ id: "alert:x", description: "old", occurredAt: "2026-09-01T09:00:00Z" }),
      item({ id: "alert:x", description: "new", occurredAt: "2026-09-01T15:00:00Z" }),
      item({ id: "alert:y", description: "other" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((i) => i.id === "alert:x")!.description).toBe("new");
  });

  it("keeps an item with a null timestamp only if no dated duplicate exists", () => {
    const out = dedupeNeedsAttention([
      item({ id: "alert:z", occurredAt: null, description: "nulltime" }),
      item({ id: "alert:z", occurredAt: "2026-09-01T10:00:00Z", description: "dated" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].description).toBe("dated");
  });
});

describe("summarize", () => {
  it("handles empty, single, plural, and critical counts", () => {
    expect(summarize([])).toBe("Nothing needs attention");
    expect(summarize([item()])).toBe("1 item needs attention");
    expect(summarize([item(), item({ id: "y" })])).toBe("2 items need attention");
    expect(summarize([item({ severity: "critical" }), item({ id: "y" })])).toBe("2 items need attention · 1 critical");
  });
});

describe("severityTone", () => {
  it("is distinct per severity", () => {
    expect(severityTone("critical")).toContain("red");
    expect(severityTone("warning")).toContain("amber");
    expect(severityTone("info")).toContain("muted");
  });
});

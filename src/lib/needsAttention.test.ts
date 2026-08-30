import { describe, expect, it } from "vitest";
import { sortNeedsAttention, summarize, severityTone, type NeedsAttentionItem } from "./needsAttention";

function item(overrides: Partial<NeedsAttentionItem> = {}): NeedsAttentionItem {
  return {
    id: "x:1",
    type: "customer_reply",
    severity: "warning",
    title: "T",
    description: "D",
    occurredAt: "2026-09-01T10:00:00Z",
    targetType: "conversation",
    targetId: "1",
    actionPath: "/app/whatsapp/inbox",
    actionLabel: "Open conversation",
    ...overrides,
  };
}

describe("sortNeedsAttention", () => {
  it("orders by severity first (critical > warning > info), then most recent", () => {
    const sorted = sortNeedsAttention([
      item({ id: "a", severity: "warning", occurredAt: "2026-09-01T12:00:00Z" }),
      item({ id: "b", severity: "critical", occurredAt: "2026-09-01T09:00:00Z" }),
      item({ id: "c", severity: "info", occurredAt: "2026-09-01T13:00:00Z" }),
      item({ id: "d", severity: "critical", occurredAt: "2026-09-01T11:00:00Z" }),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["d", "b", "a", "c"]);
  });

  it("does not mutate the input array", () => {
    const input = [item({ id: "a" }), item({ id: "b", severity: "critical" })];
    sortNeedsAttention(input);
    expect(input.map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("summarize", () => {
  it("says nothing needs attention for an empty list", () => {
    expect(summarize([])).toBe("Nothing needs attention");
  });
  it("counts items and flags criticals", () => {
    expect(summarize([item()])).toBe("1 item needs attention");
    expect(summarize([item(), item({ id: "y" })])).toBe("2 items need attention");
    expect(summarize([item({ severity: "critical" }), item({ id: "y" })])).toBe("2 items need attention · 1 critical");
  });
});

describe("severityTone", () => {
  it("returns a distinct class per severity", () => {
    expect(severityTone("critical")).toContain("red");
    expect(severityTone("warning")).toContain("amber");
    expect(severityTone("info")).toContain("muted");
  });
});

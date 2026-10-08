import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatRate,
  handlingBreakdown,
  isEmptyAnalytics,
  periodDelta,
  ratePointDelta,
  type WhatsAppOperationalAnalytics,
} from "./whatsappAnalytics";

function analytics(over: Partial<WhatsAppOperationalAnalytics> = {}): WhatsAppOperationalAnalytics {
  return {
    conversations_started: 10,
    inbound_messages: 40,
    median_human_response_seconds: 125,
    human_response_sample_size: 4,
    conversations_with_handoff: 4,
    handoff_rate: 0.4,
    median_resolution_seconds: 5400,
    conversations_resolved: 6,
    intake_applicable: 8,
    intake_completed: 5,
    intake_completion_rate: 0.625,
    handled_ai_only: 5,
    handled_human_assisted: 3,
    handled_human_only: 1,
    handled_no_agent_reply: 1,
    ...over,
  };
}

describe("formatDuration", () => {
  it("formats sub-minute, minute, hour and day scales", () => {
    expect(formatDuration(8)).toBe("8s");
    expect(formatDuration(125)).toBe("2m 5s");
    expect(formatDuration(180)).toBe("3m");
    expect(formatDuration(5400)).toBe("1h 30m");
    expect(formatDuration(7200)).toBe("2h");
    expect(formatDuration(90000)).toBe("1d 1h");
  });
  it("UNKNOWN is not ZERO: null/undefined/NaN render as an em dash", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });
  it("a genuine measured zero is 0s, not a dash", () => {
    expect(formatDuration(0)).toBe("0s");
  });
});

describe("formatRate", () => {
  it("renders a [0,1] ratio as a whole-number percent", () => {
    expect(formatRate(0.4)).toBe("40%");
    expect(formatRate(0.625)).toBe("63%");
    expect(formatRate(1)).toBe("100%");
    expect(formatRate(0)).toBe("0%"); // a real measured 0%
  });
  it("null (denominator was zero) renders as N/A, never 0%", () => {
    expect(formatRate(null)).toBe("N/A");
    expect(formatRate(undefined)).toBe("N/A");
  });
});

describe("period deltas", () => {
  it("periodDelta reports a signed integer change or 'no change'", () => {
    expect(periodDelta(12, 8)).toEqual({ direction: "up", label: "+4" });
    expect(periodDelta(8, 12)).toEqual({ direction: "down", label: "-4" });
    expect(periodDelta(5, 5)).toEqual({ direction: "flat", label: "no change" });
  });
  it("delta is 'none' (no misleading number) when either side is unknown", () => {
    expect(periodDelta(10, null).direction).toBe("none");
    expect(periodDelta(null, 10).direction).toBe("none");
    expect(ratePointDelta(0.5, null).direction).toBe("none");
  });
  it("ratePointDelta is in percentage POINTS, not relative", () => {
    expect(ratePointDelta(0.42, 0.30)).toEqual({ direction: "up", label: "+12 pts" });
    expect(ratePointDelta(0.30, 0.42)).toEqual({ direction: "down", label: "-12 pts" });
  });
});

describe("isEmptyAnalytics", () => {
  it("is empty only when there are zero conversations in the period", () => {
    expect(isEmptyAnalytics(null)).toBe(true);
    expect(isEmptyAnalytics(analytics({ conversations_started: 0 }))).toBe(true);
    expect(isEmptyAnalytics(analytics({ conversations_started: 1 }))).toBe(false);
  });
});

describe("handlingBreakdown", () => {
  it("returns the four categories with counts and shares that sum to ~1", () => {
    const rows = handlingBreakdown(analytics());
    expect(rows.map((r) => r.key)).toEqual([
      "handled_ai_only", "handled_human_assisted", "handled_human_only", "handled_no_agent_reply",
    ]);
    expect(rows.reduce((s, r) => s + r.count, 0)).toBe(10);
    expect(rows.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(1, 5);
  });
  it("all-zero handling yields 0 shares, not NaN", () => {
    const rows = handlingBreakdown(analytics({
      handled_ai_only: 0, handled_human_assisted: 0, handled_human_only: 0, handled_no_agent_reply: 0,
    }));
    expect(rows.every((r) => r.pct === 0)).toBe(true);
  });
});

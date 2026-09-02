import { describe, it, expect } from "vitest";
import { INBOX_AI_CAP_HARD_FALLBACK, INBOX_AI_CAP_MAX, isValidInboxAiCap, resolveInboxAiCap, usagePercent, utcMonthStartIso } from "./inboxAiBudget";

describe("inboxAiBudget (frontend mirror)", () => {
  it("resolveInboxAiCap matches the Deno rule: override -> env default -> hard fallback, bad values fall through", () => {
    expect(resolveInboxAiCap(250000, "1000000")).toBe(250000);
    expect(resolveInboxAiCap("250000", 1000000)).toBe(250000);
    expect(resolveInboxAiCap(null, "1000000")).toBe(1000000);
    expect(resolveInboxAiCap(undefined, undefined)).toBe(INBOX_AI_CAP_HARD_FALLBACK);
    expect(resolveInboxAiCap(0, "1000000")).toBe(1000000);
    expect(resolveInboxAiCap(INBOX_AI_CAP_MAX + 1, "1000000")).toBe(1000000);
  });

  it("isValidInboxAiCap: null ok, in-bounds integer ok, else no", () => {
    expect(isValidInboxAiCap(null)).toBe(true);
    expect(isValidInboxAiCap(1_000_000)).toBe(true);
    expect(isValidInboxAiCap(0)).toBe(false);
    expect(isValidInboxAiCap(1.5)).toBe(false);
    expect(isValidInboxAiCap(INBOX_AI_CAP_MAX + 1)).toBe(false);
  });

  it("usagePercent clamps to 0..100", () => {
    expect(usagePercent(320_000, 1_000_000)).toBe(32);
    expect(usagePercent(2_000_000, 1_000_000)).toBe(100);
    expect(usagePercent(10, 0)).toBe(0);
  });

  it("utcMonthStartIso is a UTC calendar month start", () => {
    expect(utcMonthStartIso(new Date("2026-03-17T22:45:10.000Z"))).toBe("2026-03-01T00:00:00.000Z");
  });
});

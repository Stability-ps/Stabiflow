import { describe, expect, it } from "vitest";
import { formatMoney } from "./adMoney";
import { dashboardConversationValue, dashboardMoneyValue, greetingFor, hasCurrentIntegration, homeMetricState, isMeasuredZeroMoney } from "./dashboardPresentation";

describe("Dashboard data presentation", () => {
  it("uses only current integration records, never historical activity, for connection state", () => {
    const historicalActivity = [{ action: "meta_connected" }, { action: "whatsapp_connected" }];
    expect(historicalActivity).toHaveLength(2);
    expect(hasCurrentIntegration([], "meta")).toBe(false);
    expect(hasCurrentIntegration([], "whatsapp")).toBe(false);
    expect(hasCurrentIntegration([{ provider: "meta", status: "disconnected" }], "meta")).toBe(false);
    expect(hasCurrentIntegration([{ provider: "meta", status: "connected" }], "meta")).toBe(true);
  });

  it("distinguishes no money data from an authoritative measured zero and preserves currency", () => {
    expect(dashboardMoneyValue([], "ZAR")).toBeUndefined();
    // formatMoney follows the viewer's locale (en-US: "ZAR 0.00", en-ZA:
    // "R 0,00"), so compare against it rather than one locale's spelling.
    expect(dashboardMoneyValue([{ currency: "ZAR", amount_minor: 0 }], "ZAR")).toBe(formatMoney(0, "ZAR"));
    // The row's own currency wins over the workspace currency.
    expect(dashboardMoneyValue([{ currency: "EUR", amount_minor: 1250 }], "ZAR")).toBe(formatMoney(1250, "EUR"));
    expect(dashboardMoneyValue([{ currency: "EUR", amount_minor: 1250 }], "ZAR")).toMatch(/€|EUR/);
  });

  it("does not present a disconnected empty conversation source as a measured zero", () => {
    expect(dashboardConversationValue(0, false)).toBeUndefined();
    expect(dashboardConversationValue(0, true)).toBe("0");
    expect(dashboardConversationValue(4, false)).toBe("4");
  });
});

describe("homeMetricState - never shows missing, disconnected or locked data as 0", () => {
  it("locked wins over everything", () => {
    expect(homeMetricState({ lockedPlan: "Growth plan", connected: false, value: "0", measuredZero: true })).toMatchObject({ kind: "locked", plan: "Growth plan" });
  });
  it("not connected beats a zero count", () => {
    expect(homeMetricState({ connected: false, connectNote: "Connect WhatsApp", value: "0", measuredZero: true })).toEqual({ kind: "not_connected", note: "Connect WhatsApp" });
  });
  it("no value is no data, not zero", () => {
    expect(homeMetricState({ connected: true, value: undefined, noDataNote: "Nothing recorded" })).toEqual({ kind: "no_data", note: "Nothing recorded" });
  });
  it("a measured zero is a zero, a number is a value", () => {
    expect(homeMetricState({ value: "0", measuredZero: true, zeroNote: "None yet" })).toEqual({ kind: "zero", value: "0", note: "None yet" });
    expect(homeMetricState({ value: "14", note: "Last 30 days" })).toEqual({ kind: "value", value: "14", note: "Last 30 days" });
  });
  it("recognises a measured zero money total", () => {
    expect(isMeasuredZeroMoney([{ currency: "ZAR", amount_minor: 0 }])).toBe(true);
    expect(isMeasuredZeroMoney([])).toBe(false);
    expect(isMeasuredZeroMoney([{ currency: "ZAR", amount_minor: 500 }])).toBe(false);
  });
});

describe("greetingFor", () => {
  it("uses the workspace timezone, not the device clock", () => {
    const utc0930 = new Date("2026-10-07T09:30:00Z");
    expect(greetingFor(utc0930, "UTC")).toBe("Good morning");
    expect(greetingFor(utc0930, "Asia/Tokyo")).toBe("Good evening"); // 18:30
    expect(greetingFor(new Date("2026-10-07T13:00:00Z"), "Africa/Johannesburg")).toBe("Good afternoon"); // 15:00
  });
});

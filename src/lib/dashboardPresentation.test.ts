import { describe, expect, it } from "vitest";
import { dashboardConversationValue, dashboardMoneyValue, hasCurrentIntegration } from "./dashboardPresentation";

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
    expect(dashboardMoneyValue([{ currency: "ZAR", amount_minor: 0 }], "ZAR")).toBe("ZAR 0.00");
    expect(dashboardMoneyValue([{ currency: "EUR", amount_minor: 1250 }], "ZAR")).toBe("€12.50");
  });

  it("does not present a disconnected empty conversation source as a measured zero", () => {
    expect(dashboardConversationValue(0, false)).toBeUndefined();
    expect(dashboardConversationValue(0, true)).toBe("0");
    expect(dashboardConversationValue(4, false)).toBe("4");
  });
});

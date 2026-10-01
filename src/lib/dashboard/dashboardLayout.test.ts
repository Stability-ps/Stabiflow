import { describe, expect, it } from "vitest";
import { applyPreset, moveItem, resolveLayout } from "./dashboardLayout";
import { DEFAULT_WIDGET_ORDER } from "./widgetRegistry";

const allEnabled = { isEnabled: () => true, hasPermission: () => true };
const allIds = new Set(DEFAULT_WIDGET_ORDER);

describe("resolveLayout", () => {
  it("gives a brand-new user the default order, all visible", () => {
    const layout = resolveLayout(null, allIds);
    expect(layout.map((w) => w.id)).toEqual(DEFAULT_WIDGET_ORDER);
    expect(layout.every((w) => w.visible)).toBe(true);
  });

  it("keeps a saved layout's order and visibility at the front, appending any other available widget as hidden", () => {
    const saved = [{ id: "leads", visible: false }, { id: "revenue", visible: true }];
    const layout = resolveLayout(saved, allIds);
    expect(layout.slice(0, 2)).toEqual(saved);
    expect(layout.slice(2).every((w) => !w.visible)).toBe(true);
    expect(layout.map((w) => w.id).sort()).toEqual([...allIds].sort());
  });

  it("drops a widget that's no longer available (module disabled or permission lost)", () => {
    const saved = [{ id: "revenue", visible: true }, { id: "leads", visible: true }];
    const layout = resolveLayout(saved, new Set(["revenue"]));
    expect(layout.map((w) => w.id)).toEqual(["revenue"]);
  });

  it("appends a newly-available widget as hidden, never auto-visible", () => {
    const saved = [{ id: "revenue", visible: true }];
    const layout = resolveLayout(saved, new Set(["revenue", "leads"]));
    expect(layout.find((w) => w.id === "leads")).toEqual({ id: "leads", visible: false });
  });
});

describe("applyPreset", () => {
  it("shows Business Owner preset widgets and keeps the rest available but hidden", () => {
    const layout = applyPreset("business_owner", allEnabled, allIds);
    const visibleIds = layout.filter((w) => w.visible).map((w) => w.id);
    expect(visibleIds).toContain("revenue");
    expect(visibleIds).toContain("customers");
    expect(visibleIds).not.toContain("recent_conversations");
    expect(layout.find((w) => w.id === "recent_conversations")).toEqual({ id: "recent_conversations", visible: false });
  });

  it("never includes a reserved invoice widget in any preset, even with every flag/permission granted", () => {
    for (const preset of ["business_owner", "sales", "marketing"] as const) {
      const layout = applyPreset(preset, allEnabled, allIds);
      expect(layout.some((w) => w.id === "outstanding_invoices")).toBe(false);
    }
  });
});

describe("moveItem", () => {
  it("moves an item from one index to another, preserving the rest", () => {
    expect(moveItem(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });
});

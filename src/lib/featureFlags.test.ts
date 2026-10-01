import { describe, expect, it } from "vitest";
import { filterNavItems, toFlagLookup, type FeatureFlagKey } from "./featureFlags";
import { NAV_ITEMS } from "./navigation";

describe("feature-flag navigation filtering", () => {
  it("launch posture: with no module flags on, only the focused launch navigation remains", () => {
    const items = filterNavItems(NAV_ITEMS, toFlagLookup([{ flag_key: "module.business_studio", enabled: true, reason: "everyone" }]));
    // Business and Marketing are unflagged organizational groups - they stay
    // visible (their landing page explains what's not enabled yet) even
    // when every child inside them is gated off.
    expect(items.map((i) => i.label)).toEqual(["Home", "Business", "Marketing", "Settings"]);
    const business = items.find((i) => i.label === "Business");
    expect(business?.children?.map((c) => c.label)).toEqual(["My Business", "Business Studio", "Documents"]);
    const marketing = items.find((i) => i.label === "Marketing");
    expect(marketing?.children).toEqual([]);
  });

  it("unloaded flags read as off, so gated modules never flash into view", () => {
    const items = filterNavItems(NAV_ITEMS, toFlagLookup(undefined));
    expect(items.some((i) => i.label === "Messages")).toBe(false);
  });

  it("a grandfathered / operator workspace with every module on keeps the full navigation", () => {
    const all = NAV_ITEMS.flatMap((i) => [i.flag, ...(i.children ?? []).map((c) => c.flag)]).filter(Boolean) as string[];
    const items = filterNavItems(NAV_ITEMS, toFlagLookup(all.map((k) => ({ flag_key: k, enabled: true, reason: "workspace_target" }))));
    expect(items).toHaveLength(NAV_ITEMS.length);
    expect(items.find((i) => i.label === "Messages")?.children).toHaveLength(6);
    expect(items.find((i) => i.label === "Business")?.children).toHaveLength(7);
  });

  it("gates child links independently (Messages on, Automations off)", () => {
    const items = filterNavItems(NAV_ITEMS, toFlagLookup([{ flag_key: "module.whatsapp", enabled: true, reason: "plan" }]));
    const messages = items.find((i) => i.label === "Messages");
    expect(messages?.children?.some((c) => c.label === "Automations")).toBe(false);
    expect(messages?.children?.some((c) => c.label === "Inbox")).toBe(true);
  });

  it("invoicing stays reserved-off: Invoices/Quotes never appear without the module.invoicing flag", () => {
    const all = NAV_ITEMS.flatMap((i) => [i.flag, ...(i.children ?? []).map((c) => c.flag)])
      .filter((f): f is FeatureFlagKey => Boolean(f) && f !== "module.invoicing");
    const items = filterNavItems(NAV_ITEMS, toFlagLookup(all.map((k) => ({ flag_key: k, enabled: true, reason: "workspace_target" }))));
    const business = items.find((i) => i.label === "Business");
    expect(business?.children?.some((c) => c.label === "Invoices")).toBe(false);
    expect(business?.children?.some((c) => c.label === "Quotes")).toBe(false);
  });

  it("a disabled row is treated as off", () => {
    const lookup = toFlagLookup([{ flag_key: "module.leads", enabled: false, reason: "disabled" }]);
    expect(lookup("module.leads")).toBe(false);
  });
});

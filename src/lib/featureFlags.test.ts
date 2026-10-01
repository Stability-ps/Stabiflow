import { describe, expect, it } from "vitest";
import { filterNavItems, toFlagLookup } from "./featureFlags";
import { NAV_ITEMS } from "./navigation";

describe("feature-flag navigation filtering", () => {
  it("launch posture: with no module flags on, only the focused launch navigation remains", () => {
    const items = filterNavItems(NAV_ITEMS, toFlagLookup([{ flag_key: "module.business_studio", enabled: true, reason: "everyone" }]));
    expect(items.map((i) => i.label)).toEqual(["Home", "Business Studio", "My Business", "Documents", "Billing", "Settings"]);
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
  });

  it("gates child links independently (WhatsApp on, Automations off)", () => {
    const items = filterNavItems(NAV_ITEMS, toFlagLookup([{ flag_key: "module.whatsapp", enabled: true, reason: "plan" }]));
    const whatsapp = items.find((i) => i.label === "Messages");
    expect(whatsapp?.children?.some((c) => c.label === "Automations")).toBe(false);
    expect(whatsapp?.children?.some((c) => c.label === "Inbox")).toBe(true);
  });

  it("a disabled row is treated as off", () => {
    const lookup = toFlagLookup([{ flag_key: "module.leads", enabled: false, reason: "disabled" }]);
    expect(lookup("module.leads")).toBe(false);
  });
});

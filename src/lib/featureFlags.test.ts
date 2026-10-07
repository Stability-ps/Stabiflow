import { describe, expect, it } from "vitest";
import { filterNavItems, toFlagLookup } from "./featureFlags";
import { MessageCircle } from "lucide-react";
import { NAV_ITEMS, type NavItem } from "./navigation";

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
    expect(items.some((i) => i.label === "Messages")).toBe(true);
  });

  // No current NAV_ITEMS entry has children (a7d4580 moved the Messages
  // children into page tabs), but filterNavItems still supports them.
  it("gates child links independently (parent on, one child's module off)", () => {
    const parent: NavItem = {
      label: "Messages", path: "/app/whatsapp", icon: MessageCircle, flag: "module.whatsapp",
      children: [
        { label: "Inbox", to: "/app/whatsapp/inbox" },
        { label: "Automations", to: "/app/automations?trigger=conversation", external: true, flag: "module.automations" },
      ],
    };
    const items = filterNavItems([parent], toFlagLookup([{ flag_key: "module.whatsapp", enabled: true, reason: "plan" }]));
    expect(items[0].children?.map((c) => c.label)).toEqual(["Inbox"]);
  });

  it("a disabled row is treated as off", () => {
    const lookup = toFlagLookup([{ flag_key: "module.leads", enabled: false, reason: "disabled" }]);
    expect(lookup("module.leads")).toBe(false);
  });
});

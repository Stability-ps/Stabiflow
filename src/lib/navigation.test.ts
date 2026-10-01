import { describe, expect, it } from "vitest";
import { isNavItemActive, NAV_ITEMS } from "./navigation";

describe("route-derived sidebar navigation", () => {
  it.each(NAV_ITEMS)("marks $label active at its own path ($path)", (item) => {
    expect(isNavItemActive(item, item.path)).toBe(true);
    for (const other of NAV_ITEMS.filter((i) => i.label !== item.label)) {
      expect(isNavItemActive(other, item.path)).toBe(false);
    }
  });

  it.each([
    ["Business", "/app/business-overview", "/app/customers"],
    ["Business", "/app/business-overview", "/app/leads"],
    ["Business", "/app/business-overview", "/app/business-studio"],
    ["Business", "/app/business-overview", "/app/business"],
    ["Business", "/app/business-overview", "/app/documents"],
    ["Marketing", "/app/marketing-overview", "/app/content/media-library"],
    ["Marketing", "/app/marketing-overview", "/app/campaigns/campaign-1/edit"],
    ["Marketing", "/app/marketing-overview", "/app/creative-studio"],
    ["Automations", "/app/automations", "/app/flow-ai"],
  ])("keeps %s selected on a child route (%s -> %s)", (label, _parentPath, childRoute) => {
    const item = NAV_ITEMS.find((i) => i.label === label)!;
    expect(isNavItemActive(item, childRoute)).toBe(true);
    const home = NAV_ITEMS.find((i) => i.label === "Home")!;
    expect(isNavItemActive(home, childRoute)).toBe(false);
  });

  it.each([
    ["/app/campaigns", "/app/campaigns/new"],
    ["/app/campaigns", "/app/campaigns/campaign-1/edit"],
    ["/app/content", "/app/content/media-library"],
    ["/app/settings", "/app/settings/members"],
    ["/app/leads", "/app/leads/lead-1"],
  ])("keeps %s active for its own nested route %s", (parentPath, nested) => {
    const item = NAV_ITEMS.find((i) => i.path === parentPath) ?? { label: "x", path: parentPath, icon: NAV_ITEMS[0].icon };
    expect(isNavItemActive(item, nested)).toBe(true);
  });

  it.each([
    "/app/whatsapp/inbox",
    "/app/whatsapp/contacts",
    "/app/whatsapp/templates",
    "/app/whatsapp/settings",
    "/app/whatsapp",
  ])("keeps the single Messages parent active across the whole WhatsApp section: %s", (nested) => {
    // The nav item's own path is the section root /app/whatsapp - it must
    // stay active on every child route, and nothing else may claim these.
    const messages = NAV_ITEMS.find((i) => i.label === "Messages")!;
    expect(isNavItemActive(messages, nested)).toBe(true);
    for (const other of NAV_ITEMS.filter((i) => i.label !== "Messages")) {
      expect(isNavItemActive(other, nested)).toBe(false);
    }
  });

  it("filtered/external links into other modules do NOT keep Messages selected", () => {
    const messages = NAV_ITEMS.find((i) => i.label === "Messages")!;
    const automations = NAV_ITEMS.find((i) => i.label === "Automations")!;
    // The WhatsApp sub-nav's "Automations" child is external: true, and
    // points at the shared Automations module filtered to WhatsApp - it
    // must not keep the Messages section itself marked active.
    expect(isNavItemActive(messages, "/app/automations")).toBe(false);
    expect(isNavItemActive(automations, "/app/automations")).toBe(true);
  });

  it("reserved Invoices/Quotes children participate in Business's active-matching (nav rendering hides them via feature flags, not this function)", () => {
    const business = NAV_ITEMS.find((i) => i.label === "Business")!;
    expect(isNavItemActive(business, "/app/invoices")).toBe(true);
    expect(isNavItemActive(business, "/app/quotes")).toBe(true);
  });
});

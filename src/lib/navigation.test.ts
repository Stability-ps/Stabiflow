import { describe, expect, it } from "vitest";
import { breadcrumbFor, isNavItemActive, NAV_ITEMS, NAV_SECTIONS } from "./navigation";

describe("route-derived sidebar navigation", () => {
  it.each(NAV_ITEMS)("marks $label active at $path", ({ path }) => {
    expect(isNavItemActive(path, path)).toBe(true);
    for (const other of NAV_ITEMS.filter((item) => item.path !== path)) {
      expect(isNavItemActive(other.path, path)).toBe(false);
    }
  });

  it.each([
    ["/app/campaigns", "/app/campaigns/new"],
    ["/app/campaigns", "/app/campaigns/campaign-1/edit"],
    ["/app/content", "/app/content/media-library"],
    ["/app/settings", "/app/settings/members"],
    ["/app/leads", "/app/leads/lead-1"],
  ])("keeps %s active for nested route %s", (parent, nested) => {
    expect(isNavItemActive(parent, nested)).toBe(true);
    expect(isNavItemActive("/app", nested)).toBe(false);
  });

  it.each([
    "/app/whatsapp/inbox",
    "/app/whatsapp/contacts",
    "/app/whatsapp/templates",
    "/app/whatsapp/settings",
    "/app/whatsapp",
  ])("keeps the single WhatsApp parent active across the whole section: %s", (nested) => {
    // The nav item's own path is the section root /app/whatsapp - it must
    // stay active on every child route, and nothing else may claim these.
    expect(isNavItemActive("/app/whatsapp", nested)).toBe(true);
    expect(isNavItemActive("/app", nested)).toBe(false);
    expect(isNavItemActive("/app/analytics", nested)).toBe(false);
    expect(isNavItemActive("/app/settings", nested)).toBe(false);
  });

  it("filtered links into other modules do NOT keep WhatsApp selected", () => {
    expect(isNavItemActive("/app/whatsapp", "/app/automations")).toBe(false);
    expect(isNavItemActive("/app/whatsapp", "/app/analytics")).toBe(false);
    expect(isNavItemActive("/app/automations", "/app/automations")).toBe(true);
  });
});

describe("desktop breadcrumb", () => {
  it.each([
    ["/app", ["Home"]],
    ["/app/leads", ["Customers", "Leads"]],
    ["/app/whatsapp/templates", ["Customers", "Messages", "Templates"]],
    ["/app/content/media-library", ["Marketing", "Content", "Media library"]],
    ["/app/campaigns/new", ["Marketing", "Campaigns", "New campaign"]],
    ["/app/customers/c-1", ["Customers", "Customers", "Customer"]],
    ["/app/billing", ["Billing"]],
    ["/app/settings", ["Settings"]],
    ["/app/guide", ["Guide"]],
  ])("%s → %j", (path, labels) => {
    expect(breadcrumbFor(path).map((c) => c.label)).toEqual(labels);
  });

  it("links the parent module but never the current page", () => {
    const crumbs = breadcrumbFor("/app/whatsapp/templates");
    expect(crumbs[1]).toEqual({ label: "Messages", to: "/app/whatsapp/inbox" });
    expect(crumbs.at(-1)?.to).toBeUndefined();
  });

  it("every sectioned path is a real nav item", () => {
    for (const path of NAV_SECTIONS.flatMap((s) => s.paths)) expect(NAV_ITEMS.some((i) => i.path === path)).toBe(true);
  });
});

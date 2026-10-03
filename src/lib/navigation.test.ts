import { describe, expect, it } from "vitest";
import { isNavItemActive, NAV_ITEMS } from "./navigation";

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

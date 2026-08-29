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
});

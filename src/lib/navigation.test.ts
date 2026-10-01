import { describe, expect, it } from "vitest";
import { BUSINESS_HUB_PATH, isMobileNavItemActive, isNavItemActive, mobileNavModel, mobilePageMeta, NAV_ITEMS } from "./navigation";
import { filterNavItems, type FeatureFlagKey } from "./featureFlags";

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

const flags = (...on: FeatureFlagKey[]) => (k: FeatureFlagKey) => on.includes(k);
const ALL: FeatureFlagKey[] = ["module.business_studio", "module.content", "module.campaigns", "module.creative_studio", "module.whatsapp", "module.leads", "module.customers", "module.analytics", "module.flow_ai", "module.automations", "module.integrations"];

describe("mobile navigation model", () => {
  it("puts Home, Business, WhatsApp, Leads in the bottom bar and everything else in More", () => {
    const { primary, more } = mobileNavModel(filterNavItems(NAV_ITEMS, flags(...ALL)));
    expect(primary.map((i) => i.label)).toEqual(["Home", "Business", "WhatsApp", "Leads"]);
    expect(more.map((i) => i.label)).toEqual([
      "Documents", "Content", "Campaigns", "Creative Studio", "Customers", "Analytics", "Flow AI", "Automations", "Integrations", "Billing", "Settings",
    ]);
    expect(primary.find((i) => i.label === "Business")!.path).toBe(BUSINESS_HUB_PATH);
  });

  it("respects feature flags: a Business Studio-only workspace gets no module tabs", () => {
    const { primary, more } = mobileNavModel(filterNavItems(NAV_ITEMS, flags("module.business_studio")));
    expect(primary.map((i) => i.label)).toEqual(["Home", "Business"]);
    expect(more.map((i) => i.label)).toEqual(["Documents", "Billing", "Settings"]);
  });

  it("keeps the Business tab even with every flag off (My Business and Documents are unflagged)", () => {
    const { primary } = mobileNavModel(filterNavItems(NAV_ITEMS, flags()));
    expect(primary.map((i) => i.label)).toEqual(["Home", "Business"]);
  });

  it.each(["/app/business-hub", "/app/business-studio", "/app/business", "/app/documents"])("keeps the Business tab active across the Business area: %s", (path) => {
    const { primary } = mobileNavModel(filterNavItems(NAV_ITEMS, flags(...ALL)));
    expect(primary.filter((i) => isMobileNavItemActive(i, path)).map((i) => i.label)).toEqual(["Business"]);
  });

  it.each([["/app", "Home"], ["/app/whatsapp/inbox", "WhatsApp"], ["/app/leads", "Leads"]])("marks exactly one tab active at %s", (path, label) => {
    const { primary } = mobileNavModel(filterNavItems(NAV_ITEMS, flags(...ALL)));
    expect(primary.filter((i) => isMobileNavItemActive(i, path)).map((i) => i.label)).toEqual([label]);
  });

  it("does not treat /app/business-hub as the desktop My Business item", () => {
    expect(isNavItemActive("/app/business", "/app/business-hub")).toBe(false);
  });

  it("gives detail pages a contextual back target and top-level pages none", () => {
    expect(mobilePageMeta("/app/campaigns/abc")).toEqual({ title: "Campaign", parent: "/app/campaigns" });
    expect(mobilePageMeta("/app/business")).toEqual({ title: "My Business", parent: BUSINESS_HUB_PATH });
    expect(mobilePageMeta("/app/business-studio")).toEqual({ title: "Business Studio", parent: BUSINESS_HUB_PATH });
    expect(mobilePageMeta("/app/business-hub")).toEqual({ title: "Business" });
    expect(mobilePageMeta("/app/leads")).toEqual({ title: "Leads" });
  });
});

import {
  BarChart3, Building2, Contact, CreditCard, FileText, Files, Wand2, LayoutDashboard, Megaphone, MessageCircle, Palette, Plug, Settings, Sparkles, Users, Workflow, type LucideIcon,
} from "lucide-react";
import type { FeatureFlagKey } from "@/lib/featureFlags";

export type NavChild = {
  label: string;
  // Full destination, may include a query string. `external: true` means it
  // links into another product module (Automations, Analytics) with
  // WhatsApp-filtered context rather than a page owned by this section.
  to: string;
  external?: boolean;
  /** Hidden when this module flag is off (see src/lib/featureFlags.ts). */
  flag?: FeatureFlagKey;
};

export type NavItem = { label: string; path: string; icon: LucideIcon; children?: NavChild[]; flag?: FeatureFlagKey };

// The primary sections from the StabiFlow product brief. Messages keeps its
// own page-level tabs for Inbox, Contacts, Templates and Intake, so the global
// sidebar does not duplicate those destinations.
//
// Launch navigation: items with a `flag` are advanced StabiFlow modules,
// hidden unless the workspace's feature flag is on (grandfathered
// workspaces and platform operators keep them). Items without a flag are
// the focused Business Studio launch surface every workspace sees.
export const NAV_ITEMS: NavItem[] = [
  { label: "Home", path: "/app", icon: LayoutDashboard },
  { label: "Business Studio", path: "/app/business-studio", icon: Wand2, flag: "module.business_studio" },
  { label: "My Business", path: "/app/business", icon: Building2 },
  { label: "Documents", path: "/app/documents", icon: Files },
  { label: "Creative Studio", path: "/app/creative-studio", icon: Palette, flag: "module.creative_studio" },
  { label: "Content", path: "/app/content", icon: FileText, flag: "module.content" },
  { label: "Campaigns", path: "/app/campaigns", icon: Megaphone, flag: "module.campaigns" },
  {
    // path is the section root (the index route redirects to /inbox). Using
    // the root - not a child path - is what lets the single sidebar item
    // stay selected across every /app/whatsapp/* page.
    label: "Messages",
    path: "/app/whatsapp",
    icon: MessageCircle,
    flag: "module.whatsapp",
  },
  { label: "Leads", path: "/app/leads", icon: Users, flag: "module.leads" },
  { label: "Customers", path: "/app/customers", icon: Contact, flag: "module.customers" },
  { label: "Analytics", path: "/app/analytics", icon: BarChart3, flag: "module.analytics" },
  { label: "Flow AI", path: "/app/flow-ai", icon: Sparkles, flag: "module.flow_ai" },
  { label: "Automations", path: "/app/automations", icon: Workflow, flag: "module.automations" },
  { label: "Integrations", path: "/app/integrations", icon: Plug, flag: "module.integrations" },
  { label: "Billing", path: "/app/billing", icon: CreditCard },
  { label: "Settings", path: "/app/settings", icon: Settings },
];

export function isNavItemActive(itemPath: string, pathname: string): boolean {
  if (itemPath === "/app") return pathname === "/app" || pathname === "/app/";
  // The WhatsApp product area is the one multi-page section: every
  // /app/whatsapp/* route keeps the single "Messages" parent selected,
  // regardless of which child page (inbox/contacts/templates/settings) is
  // open. Filtered links into Automations/Analytics deliberately do NOT
  // keep it selected - the user has left the section; those pages show
  // their own "came from WhatsApp" context instead.
  if (itemPath.startsWith("/app/whatsapp")) {
    return pathname === "/app/whatsapp" || pathname.startsWith("/app/whatsapp/");
  }
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}

// ---------------------------------------------------------------------------
// Mobile navigation (bottom bar + "More" sheet)
//
// Derived from the SAME feature-flag filtered list the desktop sidebar
// renders (filterNavItems in AppLayout), so module visibility is decided
// exactly once and can never drift between desktop and mobile.
// ---------------------------------------------------------------------------

/** Mobile "Business" tab: one hub for Business Studio, My Business and Documents. */
export const BUSINESS_HUB_PATH = "/app/business-hub";

const BUSINESS_AREA_PATHS = [BUSINESS_HUB_PATH, "/app/business-studio", "/app/business", "/app/documents"];

export function isBusinessAreaPath(pathname: string): boolean {
  return BUSINESS_AREA_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export type MobileNavItem = {
  key: string;
  label: string;
  path: string;
  icon: LucideIcon;
  /** Custom active matcher; defaults to isNavItemActive(path). */
  isActive?: (pathname: string) => boolean;
};

// Order of the "More" sheet. Business Studio itself lives in the Business hub.
const MORE_ORDER = [
  "/app/documents", "/app/creative-studio", "/app/content", "/app/campaigns", "/app/customers", "/app/analytics",
  "/app/flow-ai", "/app/automations", "/app/integrations", "/app/billing", "/app/settings",
];

export function mobileNavModel(visible: NavItem[]): { primary: MobileNavItem[]; more: MobileNavItem[] } {
  const byPath = new Map(visible.map((i) => [i.path, i]));
  const toMobile = (i: NavItem): MobileNavItem => ({ key: i.path, label: i.label, path: i.path, icon: i.icon });

  const primary: MobileNavItem[] = [];
  const home = byPath.get("/app");
  if (home) primary.push(toMobile(home));
  const myBusiness = byPath.get("/app/business");
  if (myBusiness) {
    primary.push({ key: "business", label: "Business", path: BUSINESS_HUB_PATH, icon: myBusiness.icon, isActive: isBusinessAreaPath });
  }
  const messages = byPath.get("/app/whatsapp");
  if (messages) primary.push({ ...toMobile(messages), path: "/app/whatsapp/inbox" });
  const leads = byPath.get("/app/leads");
  if (leads) primary.push(toMobile(leads));
  // Modules that are off simply drop out (a Business Studio-only workspace
  // gets Home / Business / More) - nothing is promoted into their slot, so a
  // tab never changes meaning between workspaces.
  const more = MORE_ORDER.map((p) => byPath.get(p)).filter((i): i is NavItem => !!i).map(toMobile);
  return { primary, more };
}

export function isMobileNavItemActive(item: MobileNavItem, pathname: string): boolean {
  return item.isActive ? item.isActive(pathname) : isNavItemActive(item.path, pathname);
}

// Contextual mobile page title + optional parent for the header back button.
type PageMeta = { title: string; parent?: string };

const DETAIL_ROUTES: { pattern: RegExp; meta: PageMeta }[] = [
  { pattern: /^\/app\/business-hub\/?$/, meta: { title: "Business" } },
  { pattern: /^\/app\/business-studio\/?$/, meta: { title: "Business Studio", parent: BUSINESS_HUB_PATH } },
  { pattern: /^\/app\/business\/?$/, meta: { title: "My Business", parent: BUSINESS_HUB_PATH } },
  { pattern: /^\/app\/documents\/?$/, meta: { title: "Documents", parent: BUSINESS_HUB_PATH } },
  { pattern: /^\/app\/whatsapp\/inbox\/?$/, meta: { title: "Messages" } },
  { pattern: /^\/app\/campaigns\/new\/?$/, meta: { title: "New campaign", parent: "/app/campaigns" } },
  { pattern: /^\/app\/campaigns\/[^/]+\/edit\/?$/, meta: { title: "Edit campaign", parent: "/app/campaigns" } },
  { pattern: /^\/app\/campaigns\/[^/]+\/?$/, meta: { title: "Campaign", parent: "/app/campaigns" } },
  { pattern: /^\/app\/customers\/[^/]+\/?$/, meta: { title: "Customer", parent: "/app/customers" } },
  { pattern: /^\/app\/operator\/?$/, meta: { title: "Operator" } },
];

export function mobilePageMeta(pathname: string): PageMeta {
  for (const r of DETAIL_ROUTES) if (r.pattern.test(pathname)) return r.meta;
  const top = NAV_ITEMS.find((i) => isNavItemActive(i.path, pathname));
  return { title: top?.label ?? "StabiFlow" };
}

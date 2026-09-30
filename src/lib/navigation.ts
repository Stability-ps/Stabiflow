import {
  BarChart3, Building2, LayoutDashboard, Megaphone, MessageCircle, Settings, Workflow, type LucideIcon,
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

// Primary navigation, redesigned around ~7 destinations a non-technical
// business owner can hold in their head at once ("powerful underneath,
// simple on the surface"). Secondary tools that used to live at the top
// level (Business Studio, Content, Campaigns, Creative Studio, Leads,
// Customers, Flow AI) now sit as children inside the section they belong
// to; Billing and Integrations moved entirely into Settings and are no
// longer sidebar destinations at all. Every existing route this file used
// to link to directly is still reachable - only the grouping changed, so
// bookmarks and deep links keep working unchanged.
//
// Invoices/Quotes are RESERVED here (not built): they carry the
// `module.invoicing` flag, which is seeded permanently OFF (`is_enabled =
// false`, a kill switch - see supabase/migrations/*_reserve_invoicing_*),
// so filterNavItems always drops them until a future branch turns the
// flag on. No route exists for them yet; do not add one before the
// invoicing module ships.
export const NAV_ITEMS: NavItem[] = [
  { label: "Home", path: "/app", icon: LayoutDashboard },
  {
    label: "Business",
    path: "/app/business-overview",
    icon: Building2,
    children: [
      { label: "My Business", to: "/app/business" },
      { label: "Business Studio", to: "/app/business-studio", flag: "module.business_studio" },
      { label: "Customers", to: "/app/customers", flag: "module.customers" },
      { label: "Leads", to: "/app/leads", flag: "module.leads" },
      { label: "Documents", to: "/app/documents" },
      { label: "Invoices", to: "/app/invoices", flag: "module.invoicing" },
      { label: "Quotes", to: "/app/quotes", flag: "module.invoicing" },
    ],
  },
  {
    // path is the section root (the index route redirects to /inbox). Using
    // the root - not a child path - is what lets the single sidebar item
    // stay selected across every /app/whatsapp/* page.
    label: "Messages",
    path: "/app/whatsapp",
    icon: MessageCircle,
    flag: "module.whatsapp",
    children: [
      { label: "Inbox", to: "/app/whatsapp/inbox" },
      { label: "Contacts", to: "/app/whatsapp/contacts" },
      { label: "Templates", to: "/app/whatsapp/templates" },
      { label: "Automations", to: "/app/automations?trigger=conversation", external: true, flag: "module.automations" },
      { label: "Analytics", to: "/app/whatsapp/analytics" },
      { label: "Settings", to: "/app/whatsapp/settings" },
    ],
  },
  {
    label: "Marketing",
    path: "/app/marketing-overview",
    icon: Megaphone,
    children: [
      { label: "Content", to: "/app/content", flag: "module.content" },
      { label: "Campaigns", to: "/app/campaigns", flag: "module.campaigns" },
      { label: "Creative Studio", to: "/app/creative-studio", flag: "module.creative_studio" },
    ],
  },
  {
    label: "Automations",
    path: "/app/automations",
    icon: Workflow,
    flag: "module.automations",
    children: [
      { label: "Flow AI", to: "/app/flow-ai", flag: "module.flow_ai" },
    ],
  },
  { label: "Analytics", path: "/app/analytics", icon: BarChart3, flag: "module.analytics" },
  { label: "Settings", path: "/app/settings", icon: Settings },
];

function childPathMatches(child: NavChild, pathname: string): boolean {
  if (child.external) return false;
  const childPath = child.to.split("?")[0];
  return pathname === childPath || pathname.startsWith(`${childPath}/`);
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.path === "/app") return pathname === "/app" || pathname === "/app/";
  if (pathname === item.path || pathname.startsWith(`${item.path}/`)) return true;
  return (item.children ?? []).some((child) => childPathMatches(child, pathname));
}

export function isNavChildActive(child: NavChild, pathname: string): boolean {
  return childPathMatches(child, pathname);
}

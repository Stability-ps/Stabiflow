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

// The primary sections from the StabiFlow product brief. "WhatsApp" is the
// one section with its own child navigation - the Inbox, Contacts and
// Templates pages plus filtered links into the shared Automations and
// Analytics modules and its own Settings view. Every other item is a
// single page.
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
  { label: "Content", path: "/app/content", icon: FileText, flag: "module.content" },
  { label: "Campaigns", path: "/app/campaigns", icon: Megaphone, flag: "module.campaigns" },
  { label: "Creative Studio", path: "/app/creative-studio", icon: Palette, flag: "module.creative_studio" },
  {
    // path is the section root (the index route redirects to /inbox). Using
    // the root - not a child path - is what lets the single sidebar item
    // stay selected across every /app/whatsapp/* page.
    label: "WhatsApp",
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
  // /app/whatsapp/* route keeps the single "WhatsApp" parent selected,
  // regardless of which child page (inbox/contacts/templates/settings) is
  // open. Filtered links into Automations/Analytics deliberately do NOT
  // keep it selected - the user has left the section; those pages show
  // their own "came from WhatsApp" context instead.
  if (itemPath.startsWith("/app/whatsapp")) {
    return pathname === "/app/whatsapp" || pathname.startsWith("/app/whatsapp/");
  }
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}

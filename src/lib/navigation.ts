import {
  BarChart3, Contact, FileText, LayoutDashboard, Megaphone, MessageCircle, Palette, Plug, Settings, Sparkles, Users, Workflow, type LucideIcon,
} from "lucide-react";

export type NavChild = {
  label: string;
  // Full destination, may include a query string. `external: true` means it
  // links into another product module (Automations, Analytics) with
  // WhatsApp-filtered context rather than a page owned by this section.
  to: string;
  external?: boolean;
};

export type NavItem = { label: string; path: string; icon: LucideIcon; children?: NavChild[] };

// The primary sections from the StabiFlow product brief. "WhatsApp" is the
// one section with its own child navigation - the Inbox, Contacts and
// Templates pages plus filtered links into the shared Automations and
// Analytics modules and its own Settings view. Every other item is a
// single page.
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", path: "/app", icon: LayoutDashboard },
  { label: "Content", path: "/app/content", icon: FileText },
  { label: "Campaigns", path: "/app/campaigns", icon: Megaphone },
  { label: "Creative Studio", path: "/app/creative-studio", icon: Palette },
  {
    // path is the section root (the index route redirects to /inbox). Using
    // the root - not a child path - is what lets the single sidebar item
    // stay selected across every /app/whatsapp/* page.
    label: "WhatsApp",
    path: "/app/whatsapp",
    icon: MessageCircle,
    children: [
      { label: "Inbox", to: "/app/whatsapp/inbox" },
      { label: "Contacts", to: "/app/whatsapp/contacts" },
      { label: "Templates", to: "/app/whatsapp/templates" },
      { label: "Automations", to: "/app/automations?trigger=conversation", external: true },
      { label: "Analytics", to: "/app/whatsapp/analytics" },
      { label: "Settings", to: "/app/whatsapp/settings" },
    ],
  },
  { label: "Leads", path: "/app/leads", icon: Users },
  { label: "Customers", path: "/app/customers", icon: Contact },
  { label: "Analytics", path: "/app/analytics", icon: BarChart3 },
  { label: "Flow AI", path: "/app/flow-ai", icon: Sparkles },
  { label: "Automations", path: "/app/automations", icon: Workflow },
  { label: "Integrations", path: "/app/integrations", icon: Plug },
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

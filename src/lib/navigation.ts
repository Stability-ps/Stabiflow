import {
  BarChart3, FileText, Inbox, LayoutDashboard, Megaphone, Palette, Plug, Settings, Sparkles, Users, Workflow, type LucideIcon,
} from "lucide-react";

export type NavItem = { label: string; path: string; icon: LucideIcon };

// The ten primary sections from the StabiFlow product brief. Everything
// past Dashboard is a Phase 4 placeholder - see each page's EmptyState
// for what still needs to land in later phases.
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", path: "/app", icon: LayoutDashboard },
  { label: "Content", path: "/app/content", icon: FileText },
  { label: "Campaigns", path: "/app/campaigns", icon: Megaphone },
  { label: "Creative Studio", path: "/app/creative-studio", icon: Palette },
  { label: "Inbox", path: "/app/inbox", icon: Inbox },
  { label: "Leads", path: "/app/leads", icon: Users },
  { label: "Analytics", path: "/app/analytics", icon: BarChart3 },
  { label: "Flow AI", path: "/app/flow-ai", icon: Sparkles },
  { label: "Automations", path: "/app/automations", icon: Workflow },
  { label: "Integrations", path: "/app/integrations", icon: Plug },
  { label: "Settings", path: "/app/settings", icon: Settings },
];

export function isNavItemActive(itemPath: string, pathname: string): boolean {
  if (itemPath === "/app") return pathname === "/app" || pathname === "/app/";
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}

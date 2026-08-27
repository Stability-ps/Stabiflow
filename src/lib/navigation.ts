import {
  BarChart3, FileText, Inbox, LayoutDashboard, Megaphone, Palette, Plug, Settings, Sparkles, Users, Workflow, type LucideIcon,
} from "lucide-react";

export type NavItem = { label: string; path: string; icon: LucideIcon };

// The ten primary sections from the StabiFlow product brief. Everything
// past Dashboard is a Phase 4 placeholder - see each page's EmptyState
// for what still needs to land in later phases.
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", path: "/", icon: LayoutDashboard },
  { label: "Content", path: "/content", icon: FileText },
  { label: "Campaigns", path: "/campaigns", icon: Megaphone },
  { label: "Creative Studio", path: "/creative-studio", icon: Palette },
  { label: "Inbox", path: "/inbox", icon: Inbox },
  { label: "Leads", path: "/leads", icon: Users },
  { label: "Analytics", path: "/analytics", icon: BarChart3 },
  { label: "Flow AI", path: "/flow-ai", icon: Sparkles },
  { label: "Automations", path: "/automations", icon: Workflow },
  { label: "Integrations", path: "/integrations", icon: Plug },
  { label: "Settings", path: "/settings", icon: Settings },
];

import {
  Activity, AlertTriangle, BadgeDollarSign, Building2, ClipboardList, CreditCard, Download, FileText, Flag, Gauge, HeartPulse,
  LayoutDashboard, Receipt, Rocket, Settings2, ShieldCheck, Sparkles, Tags, Users,
  type LucideIcon,
} from "lucide-react";
import type { AdminPermission } from "@/lib/adminPermissions";

export type AdminNavItem = { to: string; label: string; icon: LucideIcon; permission: AdminPermission; keywords?: string };
export type AdminNavSection = { label: string; items: AdminNavItem[] };

// Only sections backed by real StabiFlow data and working endpoints.
export const ADMIN_NAV: AdminNavSection[] = [
  {
    label: "Overview",
    items: [
      { to: "/admin", label: "Owner dashboard", icon: LayoutDashboard, permission: "analytics.read", keywords: "home kpi" },
      { to: "/admin/attention", label: "Needs attention", icon: AlertTriangle, permission: "analytics.read", keywords: "alerts problems failures" },
      { to: "/admin/activity", label: "Live activity", icon: Activity, permission: "analytics.read", keywords: "feed events" },
    ],
  },
  {
    label: "Customers",
    items: [
      { to: "/admin/users", label: "Users", icon: Users, permission: "users.read", keywords: "people accounts email" },
      { to: "/admin/businesses", label: "Businesses", icon: Building2, permission: "businesses.read", keywords: "workspaces companies tenants" },
    ],
  },
  {
    label: "Revenue & billing",
    items: [
      { to: "/admin/revenue", label: "Revenue", icon: BadgeDollarSign, permission: "billing.read", keywords: "mrr arr money" },
      { to: "/admin/transactions", label: "Transactions", icon: Receipt, permission: "billing.read", keywords: "payments paystack webhooks failed" },
      { to: "/admin/subscriptions", label: "Subscriptions", icon: CreditCard, permission: "billing.read", keywords: "renewals churn past due" },
      { to: "/admin/plans", label: "Plans & pricing", icon: Tags, permission: "plans.read", keywords: "price entitlements limits" },
    ],
  },
  {
    label: "Product",
    items: [
      { to: "/admin/usage", label: "Usage & AI", icon: Gauge, permission: "analytics.read", keywords: "ai tokens cost allowances automations" },
      { to: "/admin/business-studio", label: "Business Studio", icon: Sparkles, permission: "analytics.read", keywords: "profiles templates website scans" },
    ],
  },
  {
    label: "Platform",
    items: [
      { to: "/admin/features", label: "Feature flags", icon: Flag, permission: "features.read", keywords: "modules rollout" },
      { to: "/admin/content", label: "Pages & legal", icon: FileText, permission: "content.manage", keywords: "privacy terms copy faq" },
      { to: "/admin/settings", label: "Settings & copy", icon: Settings2, permission: "content.manage", keywords: "platform settings notice" },
      { to: "/admin/health", label: "System health", icon: HeartPulse, permission: "system.read", keywords: "integrations credentials failed jobs webhooks" },
      { to: "/admin/launch", label: "Launch readiness", icon: Rocket, permission: "system.read", keywords: "checks" },
      { to: "/admin/exports", label: "Exports", icon: Download, permission: "exports.create", keywords: "csv download report" },
      { to: "/admin/audit", label: "Audit log", icon: ClipboardList, permission: "audit.read", keywords: "history changes" },
    ],
  },
  {
    label: "Administration",
    items: [{ to: "/admin/staff", label: "Staff & roles", icon: ShieldCheck, permission: "admins.manage", keywords: "admins permissions team" }],
  },
];

export function visibleNav(permissions: readonly AdminPermission[]): AdminNavSection[] {
  return ADMIN_NAV.map((s) => ({ ...s, items: s.items.filter((i) => permissions.includes(i.permission)) })).filter((s) => s.items.length > 0);
}

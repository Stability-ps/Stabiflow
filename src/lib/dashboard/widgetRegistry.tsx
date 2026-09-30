import { BarChart3, Users, Wallet } from "lucide-react";
import type { PresetId, WidgetDefinition } from "@/lib/dashboard/types";
import type { FeatureFlagKey } from "@/lib/featureFlags";
import type { WorkspacePermission } from "@/lib/permissions";
import { RevenueWidget } from "@/components/dashboard/widgets/RevenueWidget";
import { RoasWidget } from "@/components/dashboard/widgets/RoasWidget";
import { LeadsWidget } from "@/components/dashboard/widgets/LeadsWidget";
import { CustomersWidget } from "@/components/dashboard/widgets/CustomersWidget";
import { CampaignSpendWidget } from "@/components/dashboard/widgets/CampaignSpendWidget";
import { ConversationsWidget } from "@/components/dashboard/widgets/ConversationsWidget";
import { LeadSourcesWidget } from "@/components/dashboard/widgets/LeadSourcesWidget";
import { WhatsAppFunnelWidget } from "@/components/dashboard/widgets/WhatsAppFunnelWidget";
import { CampaignPerformanceWidget } from "@/components/dashboard/widgets/CampaignPerformanceWidget";
import { RecentConversationsWidget } from "@/components/dashboard/widgets/RecentConversationsWidget";
import { NeedsAttentionWidget } from "@/components/dashboard/widgets/NeedsAttentionWidget";
import { RecentActivityWidget } from "@/components/dashboard/widgets/RecentActivityWidget";
import { AutomationsStatusWidget } from "@/components/dashboard/widgets/AutomationsStatusWidget";

// Every widget below is backed by a real, already-existing StabiFlow query
// (see each component) - nothing here fabricates a metric or invents a new
// backend call. Reserved invoice widgets are declared with `flag:
// "module.invoicing"` and NO component of their own; module.invoicing is a
// permanent kill switch (see the reserve-invoicing migration), so
// availableWidgets() below always filters them out before anything tries
// to render one - there is deliberately no real component to point them
// at yet.
function ReservedWidgetPlaceholder() {
  return null;
}

export const WIDGET_REGISTRY: WidgetDefinition[] = [
  { id: "revenue", label: "Revenue", description: "Attributed revenue, last 30 days.", category: "metric", defaultSize: "sm", permission: "revenue.view", presets: ["business_owner"], component: RevenueWidget },
  { id: "roas", label: "ROAS", description: "Return on ad spend, last 30 days.", category: "metric", defaultSize: "sm", permission: "revenue.view", presets: ["business_owner", "marketing"], component: RoasWidget },
  { id: "leads", label: "Leads", description: "Qualified leads, last 30 days.", category: "metric", defaultSize: "sm", flag: "module.leads", presets: ["business_owner", "sales"], component: LeadsWidget },
  { id: "customers", label: "Customers", description: "Customers, last 30 days.", category: "metric", defaultSize: "sm", flag: "module.customers", presets: ["business_owner"], component: CustomersWidget },
  { id: "campaign_spend", label: "Campaign spend", description: "Ad spend, last 30 days.", category: "metric", defaultSize: "sm", flag: "module.campaigns", presets: ["marketing"], component: CampaignSpendWidget },
  { id: "conversations", label: "Conversations", description: "WhatsApp conversations, last 30 days.", category: "metric", defaultSize: "sm", flag: "module.whatsapp", presets: ["sales"], component: ConversationsWidget },
  { id: "lead_sources", label: "Lead sources", description: "Where your leads came from.", category: "chart", defaultSize: "md", flag: "module.leads", presets: ["sales", "marketing"], component: LeadSourcesWidget },
  { id: "whatsapp_activity", label: "WhatsApp activity", description: "Conversation-to-customer funnel.", category: "chart", defaultSize: "md", flag: "module.whatsapp", presets: ["sales"], component: WhatsAppFunnelWidget },
  { id: "campaign_performance", label: "Campaign performance", description: "Top campaigns by spend.", category: "chart", defaultSize: "md", flag: "module.campaigns", presets: ["business_owner", "marketing"], component: CampaignPerformanceWidget },
  { id: "recent_conversations", label: "Recent conversations", description: "Your latest WhatsApp conversations.", category: "list", defaultSize: "md", flag: "module.whatsapp", presets: ["sales"], component: RecentConversationsWidget },
  { id: "needs_attention", label: "Needs your attention", description: "Actionable items across the workspace.", category: "list", defaultSize: "md", presets: ["business_owner", "sales"], component: NeedsAttentionWidget },
  { id: "recent_activity", label: "Recent activity", description: "What's happened in this workspace recently.", category: "activity", defaultSize: "md", presets: ["business_owner"], component: RecentActivityWidget },
  { id: "automations_status", label: "Automations", description: "How many automations are enabled.", category: "metric", defaultSize: "sm", flag: "module.automations", presets: [], component: AutomationsStatusWidget },

  // Reserved - see module comment above. Never shown; module.invoicing is
  // permanently off (is_enabled = false) until the dedicated invoicing
  // branch ships real data for these.
  { id: "outstanding_invoices", label: "Outstanding invoices", description: "Reserved for the invoicing module.", category: "metric", defaultSize: "sm", flag: "module.invoicing", presets: [], component: ReservedWidgetPlaceholder },
  { id: "overdue_invoices", label: "Overdue invoices", description: "Reserved for the invoicing module.", category: "metric", defaultSize: "sm", flag: "module.invoicing", presets: [], component: ReservedWidgetPlaceholder },
  { id: "invoice_revenue", label: "Revenue from paid invoices", description: "Reserved for the invoicing module.", category: "metric", defaultSize: "sm", flag: "module.invoicing", presets: [], component: ReservedWidgetPlaceholder },
  { id: "invoice_status", label: "Invoice status", description: "Reserved for the invoicing module.", category: "chart", defaultSize: "md", flag: "module.invoicing", presets: [], component: ReservedWidgetPlaceholder },
  { id: "recent_invoice_activity", label: "Recent invoice activity", description: "Reserved for the invoicing module.", category: "activity", defaultSize: "md", flag: "module.invoicing", presets: [], component: ReservedWidgetPlaceholder },
];

export const DEFAULT_WIDGET_ORDER: string[] = [
  "revenue", "leads", "customers", "campaign_spend", "conversations", "roas",
  "needs_attention", "campaign_performance", "recent_conversations",
  "lead_sources", "whatsapp_activity", "recent_activity", "automations_status",
];

export function getWidgetDefinition(id: string): WidgetDefinition | undefined {
  return WIDGET_REGISTRY.find((w) => w.id === id);
}

export type WidgetAvailabilityFilter = {
  isEnabled: (flag: FeatureFlagKey) => boolean;
  hasPermission: (permission: WorkspacePermission) => boolean;
};

/** A widget is available at all (can appear in the customizer, can ever be
 * rendered) only when both its module flag and its permission check pass -
 * the customizer controls layout, never access. */
export function availableWidgets(filter: WidgetAvailabilityFilter): WidgetDefinition[] {
  return WIDGET_REGISTRY.filter((w) => (!w.flag || filter.isEnabled(w.flag)) && (!w.permission || filter.hasPermission(w.permission)));
}

export const PRESET_LABELS: Record<PresetId, string> = {
  business_owner: "Business Owner",
  sales: "Sales",
  marketing: "Marketing",
};

export const PRESET_ICONS = { business_owner: Wallet, sales: Users, marketing: BarChart3 } as const;

export function widgetsForPreset(preset: PresetId, filter: WidgetAvailabilityFilter): string[] {
  const available = new Set(availableWidgets(filter).map((w) => w.id));
  return DEFAULT_WIDGET_ORDER.filter((id) => available.has(id) && getWidgetDefinition(id)?.presets.includes(preset));
}

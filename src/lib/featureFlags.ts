// Client-side view of the platform feature flags. The ONLY evaluator is
// the database function evaluate_feature_flags (see
// supabase/migrations/20261013060000_feature_flags.sql); this module just
// maps its results onto navigation and routes. Flags hide UI - they never
// delete data, and backend authorization is unchanged.
import type { NavItem } from "@/lib/navigation";

export type FeatureFlagKey =
  | "module.business_studio"
  | "module.content"
  | "module.campaigns"
  | "module.creative_studio"
  | "module.whatsapp"
  | "module.leads"
  | "module.customers"
  | "module.analytics"
  | "module.flow_ai"
  | "module.automations"
  | "module.integrations"
  | "module.invoicing";

export type EvaluatedFlag = { flag_key: string; enabled: boolean; reason: string };

export type FlagLookup = (key: FeatureFlagKey) => boolean;

export function toFlagLookup(rows: EvaluatedFlag[] | null | undefined): FlagLookup {
  const enabled = new Set((rows ?? []).filter((r) => r.enabled).map((r) => r.flag_key));
  // Unknown / not-yet-loaded flags are OFF: a gated module never flashes
  // into view for a user who should not see it.
  return (key) => enabled.has(key);
}

/** Drops nav items (and nav children) whose module flag is off. */
export function filterNavItems(items: NavItem[], isEnabled: FlagLookup): NavItem[] {
  return items
    .filter((item) => !item.flag || isEnabled(item.flag))
    .map((item) => (item.children ? { ...item, children: item.children.filter((c) => !c.flag || isEnabled(c.flag)) } : item));
}

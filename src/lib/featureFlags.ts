// Client-side view of the platform feature flags. The ONLY evaluator is
// the database function evaluate_feature_flags (see
// supabase/migrations/20261013060000_feature_flags.sql); this module just
// maps its results onto navigation and routes. Flags hide UI - they never
// delete data, and backend authorization is unchanged.
import type { NavItem } from "@/lib/navigation";
import { MODULE_LOCK_INFO } from "@/lib/moduleLockInfo";

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
  | "module.integrations";

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

/**
 * Plan-locked = the module exists and is switched on platform-wide, but the
 * workspace's plan doesn't include it (evaluator reason "not_targeted") AND a
 * plan that includes it is known (MODULE_LOCK_INFO). Those modules are shown
 * in navigation with a lock and lead to the existing upgrade screen. Every
 * other "off" reason (disabled, operators_only, a workspace override) stays
 * hidden. Display only: FeatureGate and the database keep enforcing access.
 */
export function toPlanLockLookup(rows: EvaluatedFlag[] | null | undefined): FlagLookup {
  const locked = new Set(
    (rows ?? []).filter((r) => !r.enabled && r.reason === "not_targeted" && r.flag_key in MODULE_LOCK_INFO).map((r) => r.flag_key),
  );
  return (key) => locked.has(key);
}

/** Top-level nav items whose module is plan-locked (see toPlanLockLookup). */
export function planLockedNavItems(items: NavItem[], isPlanLocked: FlagLookup): NavItem[] {
  return items.filter((item) => !!item.flag && isPlanLocked(item.flag));
}

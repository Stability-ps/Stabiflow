// Admin roles and permissions - the single source of truth, imported by the
// admin edge functions (enforcement) and by the web app (navigation only).
// Pure module: no Deno or browser APIs.

export const ADMIN_ROLES = ["owner", "admin", "support", "finance", "analyst", "marketing"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_PERMISSIONS = [
  "analytics.read",
  "users.read",
  "users.manage",
  "businesses.read",
  "businesses.manage",
  "billing.read",
  "billing.manage",
  "plans.read",
  "plans.manage",
  "features.read",
  "features.manage",
  "content.manage",
  "settings.manage",
  "exports.create",
  "audit.read",
  "system.read",
  "admins.manage",
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

const ALL = [...ADMIN_PERMISSIONS];

export const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  owner: ALL,
  // Runs the platform day to day; pricing and staff access stay with the owner.
  admin: ALL.filter((p) => p !== "admins.manage" && p !== "plans.manage"),
  // Helps customers: can see accounts and their billing state, cannot change
  // money, pricing or platform configuration.
  support: ["analytics.read", "users.read", "businesses.read", "billing.read", "plans.read", "features.read", "system.read"],
  finance: ["analytics.read", "users.read", "businesses.read", "billing.read", "billing.manage", "plans.read", "exports.create", "audit.read"],
  // Aggregate numbers only - no customer directory.
  analyst: ["analytics.read", "billing.read", "plans.read", "features.read", "exports.create"],
  marketing: ["analytics.read", "plans.read", "features.read", "content.manage"],
};

export const ROLE_LABELS: Record<AdminRole, { label: string; description: string }> = {
  owner: { label: "Owner", description: "Full authority, including pricing and staff access." },
  admin: { label: "Admin", description: "Runs the platform. Cannot change pricing or staff access." },
  support: { label: "Support", description: "Customer accounts and billing state, read-only on money and configuration." },
  finance: { label: "Finance", description: "Revenue, transactions, subscriptions and entitlement overrides." },
  analyst: { label: "Analyst", description: "Aggregate analytics and exports. No customer directory." },
  marketing: { label: "Marketing", description: "Analytics and public content." },
};

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value);
}

export function can(role: AdminRole | null | undefined, permission: AdminPermission): boolean {
  if (!role || !isAdminRole(role)) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Datasets the export centre can produce, and the permission each needs on
 * top of exports.create. */
export const EXPORT_DATASETS = {
  users: { label: "Users", permission: "users.read" },
  businesses: { label: "Businesses", permission: "businesses.read" },
  transactions: { label: "Transactions", permission: "billing.read" },
  subscriptions: { label: "Subscriptions", permission: "billing.read" },
  ai_usage: { label: "AI usage by business", permission: "analytics.read" },
  audit: { label: "Admin audit log", permission: "audit.read" },
} as const satisfies Record<string, { label: string; permission: AdminPermission }>;
export type ExportDataset = keyof typeof EXPORT_DATASETS;

export function isExportDataset(value: unknown): value is ExportDataset {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(EXPORT_DATASETS, value);
}

/** operator-admin action -> required permission. Unlisted actions are denied. */
export const OPERATOR_ADMIN_ACTIONS: Record<string, AdminPermission> = {
  overview: "analytics.read",
  usage_overview: "analytics.read",
  launch_readiness: "system.read",
  list_catalog: "plans.read",
  upsert_plan: "plans.manage",
  create_price: "plans.manage",
  update_price: "plans.manage",
  set_plan_entitlement: "plans.manage",
  remove_plan_entitlement: "plans.manage",
  list_flags: "features.read",
  update_flag: "features.manage",
  set_flag_target: "features.manage",
  remove_flag_target: "features.manage",
  list_settings: "content.manage",
  update_setting: "content.manage",
  list_subscriptions: "billing.read",
  list_transactions: "billing.read",
  list_webhook_events: "billing.read",
  workspace_commercial: "billing.read",
  grant_override: "billing.manage",
  revoke_override: "billing.manage",
  business_studio: "analytics.read",
  update_template: "content.manage",
  list_legal: "content.manage",
  save_legal_draft: "content.manage",
  delete_legal_draft: "content.manage",
  publish_legal: "content.manage",
  system_status: "system.read",
  audit_log: "audit.read",
};

/** operator-workspaces action -> required permission. */
export const OPERATOR_WORKSPACES_ACTIONS: Record<string, AdminPermission> = {
  search_workspaces: "businesses.read",
  get_workspace: "businesses.read",
  suspend_workspace: "businesses.manage",
  unsuspend_workspace: "businesses.manage",
};

/** admin-console action -> required permission. */
export const ADMIN_CONSOLE_ACTIONS: Record<string, AdminPermission> = {
  me: "analytics.read",
  overview: "analytics.read",
  attention: "analytics.read",
  activity: "analytics.read",
  search: "analytics.read",
  users: "users.read",
  user: "users.read",
  businesses: "businesses.read",
  business: "businesses.read",
  revenue: "billing.read",
  transactions: "billing.read",
  subscriptions: "billing.read",
  audit: "audit.read",
  staff: "admins.manage",
  grant_role: "admins.manage",
  revoke_role: "admins.manage",
  export: "exports.create",
};

// "me" must work for every staff role so the shell can render, so it maps to
// a permission every role has.
for (const role of ADMIN_ROLES) {
  if (!ROLE_PERMISSIONS[role].includes(ADMIN_CONSOLE_ACTIONS.me)) {
    throw new Error(`role ${role} lacks ${ADMIN_CONSOLE_ACTIONS.me}`);
  }
}

// Client-side MIRROR of workspace_role_permissions
// (supabase/migrations/20260824060200_workspace_authorization_helpers.sql).
// UX-only: used to hide/show controls a role can't use, never to decide
// whether an action is actually allowed. Every RLS policy and RPC
// re-checks has_workspace_role()/has_workspace_permission() independently
// in the database - if this file drifted out of sync or were bypassed
// entirely, the backend would still refuse the action. Do not use this as
// a substitute for has_workspace_role() rank checks either: marketing,
// sales, and support are peers in the role hierarchy, so differentiating
// what each can do must go through permission names, not rank.
export type WorkspaceRole = "owner" | "admin" | "manager" | "marketing" | "sales" | "support" | "viewer";

export type WorkspacePermission =
  | "manage_workspace"
  | "manage_members"
  | "manage_billing"
  | "manage_integrations"
  | "manage_content"
  | "manage_campaigns"
  | "manage_inbox"
  | "manage_leads"
  | "manage_pipelines"
  | "view_analytics"
  // Content module (Phase 5) - fine-grained, mirroring
  // 20260826060100_content_permissions.sql. Added alongside the existing
  // manage_content permission (kept, not removed) because marketing/sales/
  // support are rank-peers who need to be differentiated by name, not rank.
  | "content.view"
  | "content.create"
  | "content.edit"
  | "content.publish"
  | "content.delete"
  | "media.view"
  | "media.upload"
  | "media.delete"
  // Campaigns module (Phase 6) - fine-grained, mirroring
  // 20260827060100_ad_campaigns_permissions.sql. campaign.publish and
  // campaign.pause are kept separate from campaign.edit: editing a draft
  // is low-risk, publishing/pausing moves real budget/spend state.
  | "campaign.view"
  | "campaign.create"
  | "campaign.edit"
  | "campaign.publish"
  | "campaign.pause"
  | "campaign.delete"
  | "campaign.metrics.view"
  // Integrations module (Phase C) - fine-grained, mirroring
  // 20260829060000_integrations_foundation.sql. integration.view is broad
  // (every role, like content.view/campaign.view - the row never carries a
  // decrypted secret); connect/manage/disconnect stay owner/admin-only,
  // same grant set as the pre-existing manage_integrations permission.
  | "integration.view"
  | "integration.connect"
  | "integration.manage"
  | "integration.disconnect"
  // Inbox module (Phase D) - fine-grained, mirroring
  // 20260830060000_whatsapp_inbox_foundation.sql. Granted to exactly the
  // same role set the pre-existing manage_inbox permission uses
  // (owner/admin/manager/support) - unlike content.view, inbox
  // conversations carry customer PII, so this is NOT broadly granted to
  // marketing/sales/viewer.
  | "inbox.view"
  | "inbox.manage"
  // Leads/Pipelines/Opportunities module (Phase E) - fine-grained, mirroring
  // 20260901060000_leads_pipelines_schema.sql. Sales owns leads/opportunities
  // day to day; pipeline.manage (workspace sales-process configuration) is
  // manager-and-up only, same rank cutoff as manage_content/manage_campaigns.
  // Support gets lead.view/lead.create (a conversation they're handling may
  // already need one) but not edit/assign/close - marketing/viewer get
  // view-only, like content.view/campaign.view.
  | "lead.view"
  | "lead.create"
  | "lead.edit"
  | "lead.assign"
  | "lead.delete"
  | "pipeline.view"
  | "pipeline.manage"
  | "opportunity.view"
  | "opportunity.create"
  | "opportunity.edit"
  | "opportunity.close"
  // Attribution/Revenue module (Phase G) - mirroring
  // 20260904060000_attribution_and_revenue.sql. attribution.view is broad
  // (every role, like content.view) - attribution events carry marketing
  // metadata, not customer content. attribution.manage (manual overrides)
  // is manager-and-up, same cutoff as pipeline.manage. revenue.* mirrors
  // opportunity.*'s grant set - revenue is opportunity-adjacent, owned by
  // the same roles that close deals.
  | "attribution.view"
  | "attribution.manage"
  | "revenue.view"
  | "revenue.create"
  | "revenue.edit"
  // Flow AI (Phase I) - mirroring 20260910060000_flow_ai_foundation.sql.
  // Gates chat ACCESS only, granted broadly like content.view/campaign.view;
  // it does NOT grant visibility into any workspace data - every Flow AI
  // tool independently re-checks the permission the source module already
  // requires (view_analytics, revenue.view, lead.view, etc.).
  | "flow_ai.use"
  // Automation Engine (Phase J) - mirroring
  // 20260912060000_automation_engine_foundation.sql. view/view_runs are
  // broad like content.view/campaign.metrics.view (configuration
  // visibility, not sensitive data); create/edit/enable/delete are
  // manager-and-up, the same cutoff as pipeline.manage.
  | "automation.view"
  | "automation.view_runs"
  | "automation.create"
  | "automation.edit"
  | "automation.enable"
  | "automation.delete";

const PERMISSION_MATRIX: Record<WorkspaceRole, WorkspacePermission[]> = {
  owner: [
    "manage_workspace", "manage_members", "manage_billing", "manage_integrations",
    "manage_content", "manage_campaigns", "manage_inbox", "manage_leads", "manage_pipelines", "view_analytics",
    "content.view", "content.create", "content.edit", "content.publish", "content.delete",
    "media.view", "media.upload", "media.delete",
    "campaign.view", "campaign.create", "campaign.edit", "campaign.publish", "campaign.pause", "campaign.delete", "campaign.metrics.view",
    "integration.view", "integration.connect", "integration.manage", "integration.disconnect",
    "inbox.view", "inbox.manage",
    "lead.view", "lead.create", "lead.edit", "lead.assign", "lead.delete",
    "pipeline.view", "pipeline.manage",
    "opportunity.view", "opportunity.create", "opportunity.edit", "opportunity.close",
    "attribution.view", "attribution.manage", "revenue.view", "revenue.create", "revenue.edit",
    "flow_ai.use",
    "automation.view", "automation.view_runs", "automation.create", "automation.edit", "automation.enable", "automation.delete",
  ],
  admin: [
    "manage_members", "manage_integrations", "manage_content", "manage_campaigns",
    "manage_inbox", "manage_leads", "manage_pipelines", "view_analytics",
    "content.view", "content.create", "content.edit", "content.publish", "content.delete",
    "media.view", "media.upload", "media.delete",
    "campaign.view", "campaign.create", "campaign.edit", "campaign.publish", "campaign.pause", "campaign.delete", "campaign.metrics.view",
    "integration.view", "integration.connect", "integration.manage", "integration.disconnect",
    "inbox.view", "inbox.manage",
    "lead.view", "lead.create", "lead.edit", "lead.assign", "lead.delete",
    "pipeline.view", "pipeline.manage",
    "opportunity.view", "opportunity.create", "opportunity.edit", "opportunity.close",
    "attribution.view", "attribution.manage", "revenue.view", "revenue.create", "revenue.edit",
    "flow_ai.use",
    "automation.view", "automation.view_runs", "automation.create", "automation.edit", "automation.enable", "automation.delete",
  ],
  manager: [
    "manage_content", "manage_campaigns", "manage_inbox", "manage_leads", "manage_pipelines", "view_analytics",
    "content.view", "content.create", "content.edit", "content.publish", "content.delete",
    "media.view", "media.upload", "media.delete",
    "campaign.view", "campaign.create", "campaign.edit", "campaign.publish", "campaign.pause", "campaign.delete", "campaign.metrics.view",
    "integration.view",
    "inbox.view", "inbox.manage",
    "lead.view", "lead.create", "lead.edit", "lead.assign", "lead.delete",
    "pipeline.view", "pipeline.manage",
    "opportunity.view", "opportunity.create", "opportunity.edit", "opportunity.close",
    "attribution.view", "attribution.manage", "revenue.view", "revenue.create", "revenue.edit",
    "flow_ai.use",
    "automation.view", "automation.view_runs", "automation.create", "automation.edit", "automation.enable", "automation.delete",
  ],
  marketing: [
    "manage_content", "manage_campaigns", "view_analytics",
    "content.view", "content.create", "content.edit", "content.publish", "content.delete",
    "media.view", "media.upload", "media.delete",
    "campaign.view", "campaign.create", "campaign.edit", "campaign.publish", "campaign.pause", "campaign.delete", "campaign.metrics.view",
    "integration.view",
    "lead.view", "pipeline.view", "opportunity.view",
    "attribution.view", "revenue.view",
    "flow_ai.use",
    "automation.view", "automation.view_runs",
  ],
  sales: [
    "manage_leads", "view_analytics", "content.view", "media.view", "campaign.view", "campaign.metrics.view", "integration.view",
    "lead.view", "lead.create", "lead.edit", "lead.assign",
    "pipeline.view",
    "opportunity.view", "opportunity.create", "opportunity.edit", "opportunity.close",
    "attribution.view", "revenue.view", "revenue.create", "revenue.edit",
    "flow_ai.use",
    "automation.view", "automation.view_runs",
  ],
  support: [
    "manage_inbox", "manage_leads", "content.view", "media.view", "campaign.view", "campaign.metrics.view", "integration.view", "inbox.view", "inbox.manage",
    "lead.view", "lead.create",
    "pipeline.view",
    "opportunity.view",
    "attribution.view", "revenue.view",
    "flow_ai.use",
    "automation.view", "automation.view_runs",
  ],
  viewer: ["view_analytics", "content.view", "media.view", "campaign.view", "campaign.metrics.view", "integration.view", "lead.view", "pipeline.view", "opportunity.view", "attribution.view", "revenue.view", "flow_ai.use", "automation.view", "automation.view_runs"],
};

export function roleHasPermission(role: WorkspaceRole | null | undefined, permission: WorkspacePermission): boolean {
  if (!role) return false;
  return PERMISSION_MATRIX[role]?.includes(permission) ?? false;
}

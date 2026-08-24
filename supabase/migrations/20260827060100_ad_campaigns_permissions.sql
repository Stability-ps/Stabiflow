-- Fine-grained Campaigns permissions (Phase 6 instruction #21), mirroring
-- the Phase 5 content.*/media.* pattern: has_workspace_role() proves rank,
-- not a specific capability, and marketing/sales/support are rank-peers -
-- so who can create vs. publish vs. pause a paid campaign has to be a
-- named permission, not a role-rank check.
--
-- Grants mirror the existing 'manage_campaigns' permission's role set
-- (owner/admin/manager/marketing) for everything that creates, edits, or
-- spends budget, and additionally grant campaign.view/campaign.metrics.view
-- to every membership role - seeing campaign performance isn't a
-- privileged action, matching how content.view/view_analytics are already
-- broadly granted. campaign.publish and campaign.pause are kept SEPARATE
-- from campaign.edit deliberately: editing a draft is low-risk, but
-- publishing or pausing moves real budget/spend state, matching
-- instruction #16's "budget handling is high-risk" and instruction #17's
-- "require clear UI state" for pause/resume. The existing 'manage_campaigns'
-- permission is left untouched (not removed, not used by any Phase 6 RLS
-- policy) since other code may still reference it; campaign.* is additive.

insert into public.workspace_role_permissions (role, permission) values
  ('owner', 'campaign.view'), ('owner', 'campaign.create'), ('owner', 'campaign.edit'),
  ('owner', 'campaign.publish'), ('owner', 'campaign.pause'), ('owner', 'campaign.delete'), ('owner', 'campaign.metrics.view'),

  ('admin', 'campaign.view'), ('admin', 'campaign.create'), ('admin', 'campaign.edit'),
  ('admin', 'campaign.publish'), ('admin', 'campaign.pause'), ('admin', 'campaign.delete'), ('admin', 'campaign.metrics.view'),

  ('manager', 'campaign.view'), ('manager', 'campaign.create'), ('manager', 'campaign.edit'),
  ('manager', 'campaign.publish'), ('manager', 'campaign.pause'), ('manager', 'campaign.delete'), ('manager', 'campaign.metrics.view'),

  ('marketing', 'campaign.view'), ('marketing', 'campaign.create'), ('marketing', 'campaign.edit'),
  ('marketing', 'campaign.publish'), ('marketing', 'campaign.pause'), ('marketing', 'campaign.delete'), ('marketing', 'campaign.metrics.view'),

  -- Sales/support/viewer: view + metrics only. They can see spend and
  -- results (a client-facing conversation might reference performance) but
  -- never create, edit, publish, pause, or delete a paid campaign.
  ('sales', 'campaign.view'), ('sales', 'campaign.metrics.view'),
  ('support', 'campaign.view'), ('support', 'campaign.metrics.view'),
  ('viewer', 'campaign.view'), ('viewer', 'campaign.metrics.view')
on conflict (role, permission) do nothing;

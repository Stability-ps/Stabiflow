-- Fine-grained Content/Media permissions (Phase 5, safeguard #1 continued:
-- has_workspace_role() proves rank, not a specific capability - marketing,
-- sales, and support are peers in rank, so what each can do in the Content
-- module has to be expressed as named permissions, not a role-rank check).
--
-- Grants mirror the existing 'manage_content' permission's role set
-- (owner/admin/manager/marketing) for everything that creates or changes
-- content, and additionally grant *.view to every membership role - seeing
-- the content calendar/media library isn't a privileged action, matching
-- how 'view_analytics' is already broadly granted elsewhere in this table.
-- The existing 'manage_content' permission is left untouched (not removed,
-- not used by any Phase 5 RLS policy) since other code may still reference
-- it; content.*/media.* are additive.

insert into public.workspace_role_permissions (role, permission) values
  ('owner', 'content.view'), ('owner', 'content.create'), ('owner', 'content.edit'), ('owner', 'content.publish'), ('owner', 'content.delete'),
  ('owner', 'media.view'), ('owner', 'media.upload'), ('owner', 'media.delete'),

  ('admin', 'content.view'), ('admin', 'content.create'), ('admin', 'content.edit'), ('admin', 'content.publish'), ('admin', 'content.delete'),
  ('admin', 'media.view'), ('admin', 'media.upload'), ('admin', 'media.delete'),

  ('manager', 'content.view'), ('manager', 'content.create'), ('manager', 'content.edit'), ('manager', 'content.publish'), ('manager', 'content.delete'),
  ('manager', 'media.view'), ('manager', 'media.upload'), ('manager', 'media.delete'),

  ('marketing', 'content.view'), ('marketing', 'content.create'), ('marketing', 'content.edit'), ('marketing', 'content.publish'), ('marketing', 'content.delete'),
  ('marketing', 'media.view'), ('marketing', 'media.upload'), ('marketing', 'media.delete'),

  -- Sales/support/viewer: view only. They can see what's been posted (a
  -- client-facing conversation might reference it) but never create,
  -- change, publish, or delete content or media.
  ('sales', 'content.view'), ('sales', 'media.view'),
  ('support', 'content.view'), ('support', 'media.view'),
  ('viewer', 'content.view'), ('viewer', 'media.view')
on conflict (role, permission) do nothing;

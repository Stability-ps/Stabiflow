-- Launch-completion: workspace data export + deletion (Part 4).
--
-- A dedicated `workspace.delete` permission, owner-only by design (not
-- reusing `manage_workspace`, which several other owner-level actions
-- already key off) - deletion is irreversible and destroys every
-- tenant-owned row via cascade, so it gets its own explicitly-auditable
-- permission name rather than piggybacking on a broader one. Export is
-- gated on the SAME permission: it's part of the same "decide the
-- workspace's fate" surface (an owner deciding to leave and take their
-- data with them), not a separate lighter capability.
insert into public.workspace_role_permissions (role, permission) values
  ('owner', 'workspace.delete')
on conflict (role, permission) do nothing;

-- platform_deletion_log: durable, platform-side record that a workspace
-- was deleted, SURVIVING the deletion it records. workspace_activity_log
-- cannot serve this purpose - it references workspaces(id) on delete
-- cascade, so it is destroyed together with everything else the instant
-- the workspaces row goes. workspace_id here is deliberately a PLAIN uuid
-- column, not a foreign key, for exactly that reason: the row it refers
-- to is gone by the time anyone reads this log.
--
-- Never stores provider secrets or deleted customer content - only safe,
-- aggregate metadata (row counts, not row contents) and a cleanup-status
-- summary so a platform operator can tell whether Vault/Storage cleanup
-- genuinely completed for a given deletion.
create table if not exists public.platform_deletion_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  workspace_name text not null,
  workspace_slug text not null,
  deleted_by uuid references public.profiles(id) on delete set null,
  deleted_at timestamptz not null default now(),
  row_counts jsonb not null default '{}'::jsonb,
  cleanup_status jsonb not null default '{}'::jsonb
);

create index if not exists platform_deletion_log_workspace_idx
  on public.platform_deletion_log (workspace_id);

-- RLS enabled, zero policies = nobody but service_role, the same
-- "system-authored, platform-internal table" default already documented
-- and used elsewhere in this schema (see 20260829060000_integrations_foundation.sql's
-- header comment). No workspace to scope a client-select policy to even
-- if one were wanted - the workspace this log entry is about no longer
-- exists by definition.
alter table public.platform_deletion_log enable row level security;

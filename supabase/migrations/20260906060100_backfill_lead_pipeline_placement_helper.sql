-- Extracts the one-off backfill UPDATE from 20260906060000 into a reusable,
-- workspace-scoped, idempotent function - so its "never overwrite a lead
-- that already has a valid placement" and "safe to re-run" guarantees are
-- directly testable (call it again and assert nothing changes / nothing
-- is overwritten), not just a claim about a migration that already ran
-- once and can't be re-invoked from a test.
--
-- Privileged/internal only (like get_workspace_integration_secret) -
-- revoked from anon/authenticated, since this rewrites lead placement
-- workspace-wide and has no per-caller permission check of its own; every
-- real caller (this migration, a future recovery script, a test) already
-- has direct service-role access.
create or replace function public.backfill_lead_pipeline_placement(p_workspace_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.leads l
  set
    pipeline_id = dp.id,
    pipeline_stage_id = (
      select ps.id from public.pipeline_stages ps
      where ps.pipeline_id = dp.id and ps.workspace_id = l.workspace_id and ps.is_active = true
      order by ps.sort_order asc
      limit 1
    )
  from public.pipelines dp
  where dp.workspace_id = l.workspace_id
    and dp.is_default = true
    and l.workspace_id = p_workspace_id
    and l.pipeline_id is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.backfill_lead_pipeline_placement(uuid) from public, anon, authenticated;
grant execute on function public.backfill_lead_pipeline_placement(uuid) to service_role;

comment on function public.backfill_lead_pipeline_placement(uuid) is
  'Idempotent, workspace-scoped: places any lead with a null pipeline_id into its workspace''s default pipeline''s first active stage. Never touches a lead that already has a pipeline_id. Returns the number of leads updated (0 on a no-op re-run).';

-- Default-pipeline lifecycle fix (pre-Phase-H correctness fix).
--
-- Root cause (see the Phase G completion report): the ONLY thing that ever
-- created a workspace's default pipeline was a client-side useEffect on
-- /leads, gated on "pipelines.length === 0". create_workspace() never
-- created one, and leads-actions' resolveDefaultPipelineFirstStage()
-- explicitly left a lead unplaced (pipeline_id/pipeline_stage_id both
-- null) when no default pipeline existed yet - "never an error," but
-- invisible on the Kanban board until someone happened to visit /leads.
-- Confirmed live: 7 of this project's 8 workspaces currently have zero
-- pipelines.
--
-- Fix: ONE authoritative, idempotent, concurrency-safe SQL function -
-- callable from create_workspace() (atomic bootstrap), from leads-actions
-- (defensive guarantee at lead-creation time), and from pipelines-actions'
-- existing ensure_default_pipeline action (kept as a defensive/recovery
-- mechanism, now delegating to this same function instead of maintaining
-- its own second definition that could drift) - never three copies of
-- "what a default pipeline looks like."

create or replace function public.ensure_default_pipeline(p_workspace_id uuid, p_created_by uuid default null)
returns table (pipeline_id uuid, created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pipeline_id uuid;
  v_created boolean := false;
begin
  -- Callable two ways: directly by an authenticated end-user (e.g. a
  -- future admin/recovery call, or internally from create_workspace()
  -- while auth.uid() is still the just-added owner) - in that case,
  -- require the same permission pipelines-actions' own endpoint already
  -- required (pipeline.view). Or via the service role from an edge
  -- function that has ALREADY performed its own permission check on the
  -- caller's session (leads-actions/pipelines-actions both do this before
  -- ever touching the service-role client) - auth.uid() is null in that
  -- context, exactly the same trust boundary every edge function in this
  -- codebase already relies on for its privileged writes.
  if auth.uid() is not null and not public.has_workspace_permission(p_workspace_id, 'pipeline.view') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  -- The unique partial index (pipelines_one_default_idx, workspace_id
  -- where is_default) is what actually makes this concurrency-safe - two
  -- simultaneous callers can both reach this insert, but only one can
  -- ever win it. ON CONFLICT ... DO NOTHING RETURNING is null for the
  -- loser, who then just reads back the winner's row below.
  insert into public.pipelines (workspace_id, name, is_default, created_by)
  values (p_workspace_id, 'Default pipeline', true, p_created_by)
  on conflict (workspace_id) where is_default
  do nothing
  returning id into v_pipeline_id;

  if v_pipeline_id is not null then
    v_created := true;
    -- Authoritative default-stage definition, exactly matching
    -- pipelines-actions' pre-existing DEFAULT_STAGE_NAMES/is_won_stage
    -- behavior (New -> Qualified -> Proposal -> Won, only "Won" flagged
    -- is_won_stage) - unchanged, just relocated to one shared place. Runs
    -- inside the same function call as the pipeline insert, so a failure
    -- here rolls back the pipeline insert too - atomic, not "pipeline
    -- exists with zero stages" as a possible half-done state.
    insert into public.pipeline_stages (workspace_id, pipeline_id, name, sort_order, is_won_stage)
    select p_workspace_id, v_pipeline_id, s.name, s.ord - 1, s.name = 'Won'
    from unnest(array['New', 'Qualified', 'Proposal', 'Won']) with ordinality as s(name, ord);
  else
    select id into v_pipeline_id from public.pipelines where workspace_id = p_workspace_id and is_default = true;
  end if;

  return query select v_pipeline_id, v_created;
end;
$$;

comment on function public.ensure_default_pipeline(uuid, uuid) is
  'Authoritative, idempotent, concurrency-safe default-pipeline (+ stages) creation. The ONLY place "what a default pipeline looks like" is defined - called from create_workspace() (atomic bootstrap), leads-actions (defensive guarantee before placing a new lead), and pipelines-actions'' ensure_default_pipeline action (kept as a defensive/recovery mechanism).';

-- Extend create_workspace() a third time (see the Phase 5
-- content_scheduler_settings migration's own comment on this exact
-- pattern: "so every new workspace gets a ... row atomically ... no
-- separate migration needed later just to keep this table populated") so
-- workspace bootstrap is genuinely atomic and never depends on frontend
-- navigation for required infrastructure.
create or replace function public.create_workspace(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated to create a workspace' using errcode = '42501';
  end if;

  insert into public.workspaces (name, slug, created_by)
  values (p_name, p_slug, auth.uid())
  returning id into v_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, auth.uid(), 'owner');

  insert into public.workspace_settings (workspace_id) values (v_workspace_id);
  insert into public.workspace_billing (workspace_id) values (v_workspace_id);
  insert into public.content_scheduler_settings (workspace_id) values (v_workspace_id);

  -- Owner membership (above) is already visible within this same
  -- transaction, so ensure_default_pipeline's internal
  -- has_workspace_permission check passes immediately.
  perform public.ensure_default_pipeline(v_workspace_id, auth.uid());

  return v_workspace_id;
end;
$$;

-- Backfill for every workspace that predates this fix. Idempotent (safe
-- to re-run: ensure_default_pipeline no-ops if a default already exists,
-- and the lead UPDATE below only ever touches rows where pipeline_id IS
-- NULL) and workspace-scoped throughout - no workspace name/slug is
-- special-cased.
do $$
declare
  r record;
begin
  for r in select id, created_by from public.workspaces loop
    perform public.ensure_default_pipeline(r.id, r.created_by);
  end loop;
end
$$;

-- Any pre-existing lead left unplaced by the old lazy-init gap gets
-- placed into ITS workspace's default pipeline's first active stage - the
-- exact same rule leads-actions' own resolveDefaultPipelineFirstStage
-- already uses for brand-new leads. Never touches a lead that already has
-- a pipeline_id (real, possibly customized, placement is never
-- overwritten). The existing leads_validate_workspace_consistency_trg
-- trigger (20260901060000) still fires on this UPDATE and would reject
-- any cross-workspace assignment - this backfill inherits that defense
-- for free, it doesn't have to reimplement it.
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
  and l.pipeline_id is null;

-- WhatsApp Inbox AI: a workspace can only LOWER its monthly AI token cap.
--
-- set_workspace_inbox_ai_cap (SECURITY DEFINER, callable by any member with
-- manage_billing) accepted any cap up to 2^40 and wrote it into
-- workspace_billing.limits.whatsapp_inbox_ai_monthly_token_limit - the same
-- key the platform uses to grant a workspace a larger allowance, which
-- workspace_ai_token_cap returns ahead of the plan default. The only thing
-- stopping an owner from raising their own cap was an unrelated guard
-- (workspace_billing_protect_status rejects every non-service-role change to
-- limits), which also means owners could never set a lower cap either.
--
-- Now there are two separate values:
-- - plan/platform cap: the plan default, or a platform-granted value in
--   workspace_billing.limits (service role only, unchanged);
-- - workspace self cap: workspace_settings.inbox_ai_monthly_token_self_cap,
--   set by an owner/manage_billing member.
-- The effective cap is the SMALLER of the two, so a self cap can only reduce
-- spend, and a downgrade (smaller plan cap) can never be undone by a stored
-- self cap. A requested cap above the plan cap is rejected with a clear
-- error (not silently clamped); clearing it (NULL) returns to the plan cap.

alter table public.workspace_settings
  add column if not exists inbox_ai_monthly_token_self_cap bigint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workspace_settings_inbox_ai_self_cap_positive') then
    alter table public.workspace_settings
      add constraint workspace_settings_inbox_ai_self_cap_positive
      check (inbox_ai_monthly_token_self_cap is null or inbox_ai_monthly_token_self_cap > 0);
  end if;
end;
$$;

-- Plan/platform cap only (no self cap). Internal: called by the
-- SECURITY DEFINER functions below, never exposed to clients.
create or replace function public._workspace_ai_plan_token_cap(p_workspace_id uuid, p_feature text)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_explicit bigint;
  v_codes text[];
begin
  if p_feature not in ('flow_ai', 'whatsapp_inbox_ai') then
    raise exception 'Unknown AI feature' using errcode = '22023';
  end if;

  select case
    when p_feature = 'flow_ai' then nullif(limits ->> 'flow_ai_monthly_token_limit', '')::bigint
    else nullif(limits ->> 'whatsapp_inbox_ai_monthly_token_limit', '')::bigint
  end
  into v_explicit
  from public.workspace_billing
  where workspace_id = p_workspace_id;

  if v_explicit is not null then return v_explicit; end if;

  v_codes := public.workspace_plan_codes(p_workspace_id);

  if 'growth' = any(v_codes) or 'pro' = any(v_codes) then
    return 500000;
  elsif 'business' = any(v_codes) then
    return case when p_feature = 'flow_ai' then 100000 else 50000 end;
  else
    return 500000;
  end if;
end;
$$;

revoke execute on function public._workspace_ai_plan_token_cap(uuid, text) from public, anon, authenticated;
grant execute on function public._workspace_ai_plan_token_cap(uuid, text) to service_role;

-- Effective cap (what Flow AI and the WhatsApp webhook enforce). Same
-- signature, authorization and callers as before.
create or replace function public.workspace_ai_token_cap(p_workspace_id uuid, p_feature text)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan bigint;
  v_self bigint;
begin
  if auth.role() is distinct from 'service_role'
     and not public.is_platform_operator()
     and not public.is_workspace_member(p_workspace_id) then
    raise exception 'Not authorized for this workspace' using errcode = '42501';
  end if;

  v_plan := public._workspace_ai_plan_token_cap(p_workspace_id, p_feature);

  if p_feature = 'whatsapp_inbox_ai' then
    select s.inbox_ai_monthly_token_self_cap into v_self
    from public.workspace_settings s
    where s.workspace_id = p_workspace_id;
    if v_self is not null then
      return least(v_plan, v_self);
    end if;
  end if;
  return v_plan;
end;
$$;

revoke execute on function public.workspace_ai_token_cap(uuid, text) from public, anon;
grant execute on function public.workspace_ai_token_cap(uuid, text) to authenticated, service_role;

-- Set (or clear, with NULL) the workspace's own Inbox AI cap. Returns the
-- stored self cap. Never touches workspace_billing.
create or replace function public.set_workspace_inbox_ai_cap(p_workspace_id uuid, p_cap bigint default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan bigint;
begin
  if not public.has_workspace_permission(p_workspace_id, 'manage_billing') then
    raise exception 'Not authorized to change AI usage limits for this workspace' using errcode = '42501';
  end if;

  if p_cap is not null then
    if p_cap < 1 then
      raise exception 'Inbox AI monthly token cap must be at least 1' using errcode = '22003';
    end if;
    v_plan := public._workspace_ai_plan_token_cap(p_workspace_id, 'whatsapp_inbox_ai');
    if p_cap > v_plan then
      raise exception 'Your plan allows up to % WhatsApp AI tokens a month. Choose a cap at or below that, or upgrade in Billing & plans.', v_plan
        using errcode = '22003';
    end if;
  end if;

  insert into public.workspace_settings (workspace_id, inbox_ai_monthly_token_self_cap)
  values (p_workspace_id, p_cap)
  on conflict (workspace_id) do update set inbox_ai_monthly_token_self_cap = excluded.inbox_ai_monthly_token_self_cap;

  return p_cap;
end;
$$;

revoke execute on function public.set_workspace_inbox_ai_cap(uuid, bigint) from public, anon;
grant execute on function public.set_workspace_inbox_ai_cap(uuid, bigint) to authenticated, service_role;

-- What the Settings card shows: plan cap, the workspace's own cap and the
-- effective cap. Members only.
create or replace function public.get_workspace_inbox_ai_cap(p_workspace_id uuid)
returns table (plan_cap bigint, self_cap bigint, effective_cap bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_workspace_member(p_workspace_id) and not public.is_platform_operator() then
    raise exception 'Not authorized for this workspace' using errcode = '42501';
  end if;
  return query
    select public._workspace_ai_plan_token_cap(p_workspace_id, 'whatsapp_inbox_ai'),
           (select s.inbox_ai_monthly_token_self_cap from public.workspace_settings s where s.workspace_id = p_workspace_id),
           public.workspace_ai_token_cap(p_workspace_id, 'whatsapp_inbox_ai');
end;
$$;

revoke execute on function public.get_workspace_inbox_ai_cap(uuid) from public, anon;
grant execute on function public.get_workspace_inbox_ai_cap(uuid) to authenticated, service_role;

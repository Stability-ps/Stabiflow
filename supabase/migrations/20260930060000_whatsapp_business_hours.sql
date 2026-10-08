-- Phase 12 - WhatsApp business hours + business-hours-aware SLA.
--
-- Extends Phase 5 (it does NOT create a second SLA system): a
-- workspace-level weekly schedule + workspace timezone -> an authoritative
-- open/closed and "business minutes elapsed" calculation -> the EXISTING
-- public.sla_sweep() counts BUSINESS minutes (not wall-clock) when a
-- workspace has business hours ENABLED, so the handoff SLA does not expire
-- while the business is closed. Optionally, ONE outside-hours
-- acknowledgement per conversation per closed period.
--
-- BACKWARD COMPATIBILITY (critical): business_hours_enabled defaults FALSE.
-- Every existing workspace keeps Phase-5 elapsed-wall-clock SLA behaviour
-- unchanged until an admin explicitly enables business hours. The seven
-- schedule rows backfilled below are inert while the flag is off - they
-- exist only so the Settings card has something to render/edit.
--
-- SCOPE (documented contracts):
--   * ONE interval per weekday (no split shifts).
--   * SAME-DAY intervals only: opens_at < closes_at is enforced. Overnight
--     (e.g. 22:00->06:00) is NOT supported and is rejected by the CHECK.
--   * The schedule is workspace-level (not per number, per agent, per
--     department). Public holidays / vacation mode are out of scope.
--   * DST: all local<->UTC conversion goes through PostgreSQL IANA
--     timezone semantics (timezone(tz, ts)); no manual offset tables.

-- ====================================================================
-- 1. workspace_business_hours - one authoritative row per weekday
-- ====================================================================

create table if not exists public.workspace_business_hours (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 1 and 7), -- ISO: 1=Mon .. 7=Sun
  is_open boolean not null default false,
  opens_at time without time zone,
  closes_at time without time zone,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, day_of_week),
  -- an open day must carry a valid same-day interval; a closed day carries no times
  constraint workspace_business_hours_interval_chk check (
    (is_open = false) or (opens_at is not null and closes_at is not null and opens_at < closes_at)
  )
);

comment on table public.workspace_business_hours is
  'Phase 12: a workspace''s weekly WhatsApp business-hours schedule - exactly one row per ISO weekday (1=Mon..7=Sun). Local wall-clock time in the workspace''s configured timezone (workspace_settings.timezone). One same-day interval per day; opens_at < closes_at is enforced. Inert unless workspace_settings.business_hours_enabled is true.';

drop trigger if exists set_workspace_business_hours_updated_at on public.workspace_business_hours;
create trigger set_workspace_business_hours_updated_at
  before update on public.workspace_business_hours
  for each row execute function public.set_updated_at();

create index if not exists workspace_business_hours_workspace_idx
  on public.workspace_business_hours (workspace_id);

alter table public.workspace_business_hours enable row level security;

-- Read: any workspace member (mirrors workspace_settings_select_member).
drop policy if exists "workspace_business_hours_select_member" on public.workspace_business_hours;
create policy "workspace_business_hours_select_member"
on public.workspace_business_hours for select
to authenticated
using (public.is_workspace_member(workspace_id));

-- Write: workspace admin/owner (mirrors workspace_settings_update_admin).
drop policy if exists "workspace_business_hours_insert_admin" on public.workspace_business_hours;
create policy "workspace_business_hours_insert_admin"
on public.workspace_business_hours for insert
to authenticated
with check (public.has_workspace_role(workspace_id, 'admin'));

drop policy if exists "workspace_business_hours_update_admin" on public.workspace_business_hours;
create policy "workspace_business_hours_update_admin"
on public.workspace_business_hours for update
to authenticated
using (public.has_workspace_role(workspace_id, 'admin'))
with check (public.has_workspace_role(workspace_id, 'admin'));

drop policy if exists "workspace_business_hours_delete_admin" on public.workspace_business_hours;
create policy "workspace_business_hours_delete_admin"
on public.workspace_business_hours for delete
to authenticated
using (public.has_workspace_role(workspace_id, 'admin'));

-- ====================================================================
-- 2. workspace_settings - the enable flag + the outside-hours reply
-- ====================================================================

alter table public.workspace_settings
  add column if not exists business_hours_enabled boolean not null default false,
  add column if not exists outside_hours_auto_reply_enabled boolean not null default false,
  add column if not exists outside_hours_auto_reply_message text;

-- Server-side validation (never rely on the React form): an enabled
-- outside-hours reply must carry a non-blank message.
alter table public.workspace_settings drop constraint if exists workspace_settings_outside_hours_msg_chk;
alter table public.workspace_settings
  add constraint workspace_settings_outside_hours_msg_chk check (
    outside_hours_auto_reply_enabled = false
    or (outside_hours_auto_reply_message is not null and length(btrim(outside_hours_auto_reply_message)) > 0)
  );

comment on column public.workspace_settings.business_hours_enabled is
  'Phase 12: when true, sla_sweep() counts only OPEN business minutes toward handoff_sla_minutes (SLA pauses while closed), using workspace_business_hours + workspace_settings.timezone. Default false = unchanged Phase-5 elapsed-wall-clock SLA.';
comment on column public.workspace_settings.outside_hours_auto_reply_enabled is
  'Phase 12: when true (and business_hours_enabled is true), an inbound customer message received while the workspace is CLOSED triggers ONE system acknowledgement per conversation per closed period. Default false.';
comment on column public.workspace_settings.outside_hours_auto_reply_message is
  'Phase 12: the workspace-authored outside-hours acknowledgement text. Must be non-blank whenever outside_hours_auto_reply_enabled is true (CHECK).';

-- ====================================================================
-- 3. inbox_conversations - the per-closed-period ack dedupe key
-- ====================================================================

alter table public.inbox_conversations
  add column if not exists last_outside_hours_ack_period_key text;

comment on column public.inbox_conversations.last_outside_hours_ack_period_key is
  'Phase 12: the closed-period key of the most recent outside-hours acknowledgement sent on this conversation. Compare-and-set via claim_outside_hours_ack() gives at-most-one acknowledgement per conversation per closed period, safe under webhook retries and concurrent processing.';

-- ====================================================================
-- 4. Authoritative business-time helpers (ONE definition; SQL)
-- ====================================================================

-- Is the workspace open at instant p_at (its own timezone + schedule)?
create or replace function public.workspace_is_open_at(p_workspace_id uuid, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (
    select coalesce(nullif(btrim(s.timezone), ''), 'Africa/Johannesburg') as tz
    from public.workspace_settings s
    where s.workspace_id = p_workspace_id
  )
  select coalesce((
    select exists (
      select 1
      from cfg, public.workspace_business_hours h
      where h.workspace_id = p_workspace_id
        and h.is_open = true
        and h.opens_at is not null and h.closes_at is not null
        and h.day_of_week = extract(isodow from (p_at at time zone cfg.tz))::int
        and (p_at at time zone cfg.tz)::time >= h.opens_at
        and (p_at at time zone cfg.tz)::time <  h.closes_at
    )
  ), false);
$$;

comment on function public.workspace_is_open_at(uuid, timestamptz) is
  'Phase 12: true iff the workspace''s configured weekly schedule has an open interval covering p_at in the workspace timezone. Same-day intervals only. Returns false when there is no schedule / no timezone.';

-- Open BUSINESS minutes elapsed between two instants (order-insensitive).
-- Walks each local calendar day in range, intersects that day's open
-- interval (converted local->UTC, DST-correct) with [start,end), sums the
-- overlap. Bounded: generate_series is over calendar days in range only.
create or replace function public.business_minutes_between(
  p_workspace_id uuid, p_start timestamptz, p_end timestamptz
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (
    select coalesce(nullif(btrim(s.timezone), ''), 'Africa/Johannesburg') as tz
    from public.workspace_settings s
    where s.workspace_id = p_workspace_id
  ),
  bounds as (
    select least(p_start, p_end) as lo, greatest(p_start, p_end) as hi, (select tz from cfg) as tz
  ),
  days as (
    select g::date as local_date
    from bounds b,
         generate_series(
           (b.lo at time zone b.tz)::date::timestamp,
           (b.hi at time zone b.tz)::date::timestamp,
           interval '1 day'
         ) as g
  ),
  windows as (
    select
      timezone(b.tz, (d.local_date + h.opens_at)::timestamp)  as open_utc,
      timezone(b.tz, (d.local_date + h.closes_at)::timestamp) as close_utc,
      b.lo, b.hi
    from days d
    cross join bounds b
    join public.workspace_business_hours h
      on h.workspace_id = p_workspace_id
     and h.is_open = true
     and h.opens_at is not null and h.closes_at is not null
     and h.day_of_week = extract(isodow from d.local_date)::int
  )
  select coalesce(round(sum(
           extract(epoch from (least(w.close_utc, w.hi) - greatest(w.open_utc, w.lo))) / 60.0
         ))::integer, 0)
  from windows w
  where least(w.close_utc, w.hi) > greatest(w.open_utc, w.lo);
$$;

comment on function public.business_minutes_between(uuid, timestamptz, timestamptz) is
  'Phase 12: whole OPEN business minutes between two instants for a workspace''s schedule + timezone (DST-correct via PostgreSQL IANA conversion). Closed periods contribute zero. Order-insensitive. The single authoritative business-time calculation; sla_sweep() and the webhook both use it (never a re-implementation).';

-- The deterministic identity of the CURRENT closure: the instant the
-- workspace most recently closed at or before p_at (looking back 8 local
-- days). NULL when currently OPEN. 'always_closed' when there is no open
-- interval at all in the lookback window.
create or replace function public.workspace_closed_period_key(p_workspace_id uuid, p_at timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_last_close timestamptz;
begin
  if public.workspace_is_open_at(p_workspace_id, p_at) then
    return null; -- open now: no acknowledgement, no key
  end if;

  select coalesce(nullif(btrim(s.timezone), ''), 'Africa/Johannesburg')
    into v_tz
  from public.workspace_settings s
  where s.workspace_id = p_workspace_id;
  if v_tz is null then v_tz := 'Africa/Johannesburg'; end if;

  select max(timezone(v_tz, (g::date + h.closes_at)::timestamp))
    into v_last_close
  from generate_series(
         ((p_at at time zone v_tz)::date - 8)::timestamp,
         (p_at at time zone v_tz)::date::timestamp,
         interval '1 day'
       ) as g
  join public.workspace_business_hours h
    on h.workspace_id = p_workspace_id
   and h.is_open = true
   and h.opens_at is not null and h.closes_at is not null
   and h.day_of_week = extract(isodow from g::date)::int
  where timezone(v_tz, (g::date + h.closes_at)::timestamp) <= p_at;

  return coalesce('closed:' || v_last_close::text, 'always_closed');
end;
$$;

comment on function public.workspace_closed_period_key(uuid, timestamptz) is
  'Phase 12: NULL when the workspace is open at p_at; otherwise a deterministic string naming the current closure (the most recent close instant, or ''always_closed''). Used by the webhook to dedupe the outside-hours acknowledgement to one per conversation per closed period.';

-- Atomic compare-and-set: stamp last_outside_hours_ack_period_key and
-- return whether THIS call won the right to send. Safe under concurrent
-- webhook processing and webhook retries (single UPDATE, IS DISTINCT FROM).
create or replace function public.claim_outside_hours_ack(p_conversation_id uuid, p_period_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.inbox_conversations
    set last_outside_hours_ack_period_key = p_period_key
    where id = p_conversation_id
      and last_outside_hours_ack_period_key is distinct from p_period_key;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

comment on function public.claim_outside_hours_ack(uuid, text) is
  'Phase 12: atomically claims the right to send ONE outside-hours acknowledgement for (conversation, closed-period). Returns true only for the caller that transitioned the key; retries / concurrent callers get false.';

revoke all on function public.workspace_is_open_at(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.business_minutes_between(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.workspace_closed_period_key(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_outside_hours_ack(uuid, text) from public, anon, authenticated;
grant execute on function public.workspace_is_open_at(uuid, timestamptz) to service_role;
grant execute on function public.business_minutes_between(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.workspace_closed_period_key(uuid, timestamptz) to service_role;
grant execute on function public.claim_outside_hours_ack(uuid, text) to service_role;

-- ====================================================================
-- 5. sla_sweep() - business-minutes-aware when enabled (Phase-5 rewrite)
-- ====================================================================
-- Only the threshold comparisons change. When business_hours_enabled is
-- false the expression is byte-for-byte the Phase-5 elapsed-wall-clock
-- test. When true, the SLA threshold means allowed OPEN business minutes;
-- the expensive business_minutes_between() is gated behind the cheap
-- wall-clock pre-check (business minutes can never exceed wall minutes),
-- so it only runs for conversations already past wall-clock threshold.

create or replace function public.sla_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_raise_limit int := 500;
  v_resolved int := 0;
  v_upgraded int := 0;
  v_raised jsonb := '[]'::jsonb;
  v_resolved_rows jsonb := '[]'::jsonb;
begin
  -- (a) RESOLVE STALE (unchanged from Phase 5).
  with recovered as (
    update public.inbox_alerts a
    set is_resolved = true, resolved_at = v_now
    from public.inbox_conversations c
    left join public.workspace_settings s on s.workspace_id = c.workspace_id
    where a.alert_type = 'handoff_sla_overdue'
      and a.is_resolved = false
      and a.message_id is null
      and c.id = a.conversation_id
      and (
        c.status <> 'human_handoff'
        or c.ai_enabled = true
        or c.inbox_status = 'resolved'
        or c.human_handoff_requested_at is null
        or (c.last_staff_reply_at is not null and c.last_staff_reply_at >= c.human_handoff_requested_at)
        or coalesce(s.handoff_sla_enabled, false) = false
      )
    returning a.workspace_id, a.conversation_id
  )
  select count(*), coalesce(jsonb_agg(jsonb_build_object('workspace_id', workspace_id, 'conversation_id', conversation_id)), '[]'::jsonb)
    into v_resolved, v_resolved_rows
  from recovered;

  insert into public.workspace_activity_log (workspace_id, actor_user_id, action, target_type, target_id, metadata)
  select (r->>'workspace_id')::uuid, null, 'handoff_sla_resolved', 'inbox_conversation', (r->>'conversation_id')::uuid, '{}'::jsonb
  from jsonb_array_elements(v_resolved_rows) r;

  -- (b) RAISE: newly overdue with no open SLA alert. Phase 12: "overdue"
  -- = business minutes elapsed >= threshold when business_hours_enabled,
  -- else elapsed wall-clock >= threshold.
  with overdue as (
    select c.id as conversation_id, c.workspace_id, c.human_handoff_requested_at as started_at,
           c.assigned_staff_id, coalesce(c.display_name, c.wa_id) as who,
           s.handoff_sla_minutes,
           s.business_hours_enabled,
           case
             when s.business_hours_enabled
               then public.business_minutes_between(c.workspace_id, c.human_handoff_requested_at, v_now)
             else (extract(epoch from (v_now - c.human_handoff_requested_at)) / 60)::int
           end as waited_minutes
    from public.inbox_conversations c
    join public.workspace_settings s on s.workspace_id = c.workspace_id
    where c.status = 'human_handoff'
      and c.ai_enabled = false
      and c.inbox_status <> 'resolved'
      and c.human_handoff_requested_at is not null
      and s.handoff_sla_enabled = true
      and (c.last_staff_reply_at is null or c.last_staff_reply_at < c.human_handoff_requested_at)
      -- cheap wall-clock pre-check gates the expensive business-minute call
      and (v_now - c.human_handoff_requested_at) >= make_interval(mins => s.handoff_sla_minutes)
      and (
        not s.business_hours_enabled
        or public.business_minutes_between(c.workspace_id, c.human_handoff_requested_at, v_now) >= s.handoff_sla_minutes
      )
      and not exists (
        select 1 from public.inbox_alerts a
        where a.conversation_id = c.id and a.alert_type = 'handoff_sla_overdue'
          and a.is_resolved = false and a.message_id is null
      )
    order by c.human_handoff_requested_at asc
    limit v_raise_limit
  ),
  inserted as (
    insert into public.inbox_alerts (workspace_id, conversation_id, alert_type, severity, title, body, assigned_staff_id)
    select o.workspace_id, o.conversation_id, 'handoff_sla_overdue',
           case when o.waited_minutes >= o.handoff_sla_minutes * 2 then 'critical' else 'warning' end,
           'Customer waiting for a human response',
           o.who || ' has been waiting ' || o.waited_minutes ||
             case when o.business_hours_enabled then ' business min' else ' min' end ||
             ' for a human reply (SLA ' || o.handoff_sla_minutes || ' min).',
           o.assigned_staff_id
    from overdue o
    on conflict (alert_type, conversation_id) where (message_id is null and is_resolved = false) do nothing
    returning workspace_id, conversation_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'workspace_id', i.workspace_id, 'conversation_id', i.conversation_id,
           'started_at', o.started_at)), '[]'::jsonb)
    into v_raised
  from inserted i join overdue o on o.conversation_id = i.conversation_id;

  insert into public.domain_events (workspace_id, event_type, entity_type, entity_id, payload, dedupe_key)
  select (r->>'workspace_id')::uuid, 'conversation.handoff_sla_overdue', 'inbox_conversation', (r->>'conversation_id')::uuid,
         jsonb_build_object('entity_id', r->>'conversation_id', 'conversation_id', r->>'conversation_id', 'handoff_started_at', r->>'started_at'),
         'conversation.handoff_sla_overdue:' || (r->>'conversation_id') || ':' || (r->>'started_at')
  from jsonb_array_elements(v_raised) r
  on conflict (dedupe_key) do nothing;

  insert into public.workspace_activity_log (workspace_id, actor_user_id, action, target_type, target_id, metadata)
  select (r->>'workspace_id')::uuid, null, 'handoff_sla_overdue', 'inbox_conversation', (r->>'conversation_id')::uuid,
         jsonb_build_object('handoff_started_at', r->>'started_at')
  from jsonb_array_elements(v_raised) r;

  -- (c) UPGRADE warning -> critical at 2x threshold. Phase 12: 2x OPEN
  -- business minutes when enabled.
  with upgraded as (
    update public.inbox_alerts a
    set severity = 'critical'
    from public.inbox_conversations c
    join public.workspace_settings s on s.workspace_id = c.workspace_id
    where a.alert_type = 'handoff_sla_overdue'
      and a.is_resolved = false
      and a.message_id is null
      and a.severity <> 'critical'
      and c.id = a.conversation_id
      and s.handoff_sla_enabled = true
      and (
        case
          when s.business_hours_enabled
            then public.business_minutes_between(c.workspace_id, c.human_handoff_requested_at, v_now) >= s.handoff_sla_minutes * 2
          else (v_now - c.human_handoff_requested_at) >= make_interval(mins => s.handoff_sla_minutes * 2)
        end
      )
    returning a.id
  )
  select count(*) into v_upgraded from upgraded;

  return jsonb_build_object(
    'raised', jsonb_array_length(v_raised),
    'resolved', v_resolved,
    'upgraded', v_upgraded,
    'at', v_now
  );
end;
$$;

comment on function public.sla_sweep() is
  'Phase 5 + 12: one idempotent, set-based pass. Resolves recovered SLA alerts; raises one handoff_sla_overdue inbox_alert per newly-overdue human-handoff conversation (emitting conversation.handoff_sla_overdue + one activity row per episode); upgrades warning->critical at 2x threshold. When workspace_settings.business_hours_enabled is true the threshold means OPEN BUSINESS minutes (business_minutes_between), so the SLA pauses while the workspace is closed; otherwise it is elapsed wall-clock exactly as Phase 5. Service role only.';

revoke execute on function public.sla_sweep() from public;
revoke execute on function public.sla_sweep() from anon;
revoke execute on function public.sla_sweep() from authenticated;
grant execute on function public.sla_sweep() to service_role;

-- ====================================================================
-- 6. Backfill a sensible (inert) default schedule for existing workspaces
-- ====================================================================
-- Mon-Fri 08:00-17:00 open, Sat/Sun closed. Purely so the Settings card
-- renders an editable schedule; business_hours_enabled stays false, so
-- SLA / webhook behaviour is byte-for-byte unchanged after this migration.

insert into public.workspace_business_hours (workspace_id, day_of_week, is_open, opens_at, closes_at)
select w.id, d.dow,
       (d.dow between 1 and 5) as is_open,
       case when d.dow between 1 and 5 then time '08:00' end,
       case when d.dow between 1 and 5 then time '17:00' end
from public.workspaces w
cross join (select generate_series(1, 7) as dow) d
on conflict (workspace_id, day_of_week) do nothing;

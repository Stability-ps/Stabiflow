-- Phase 5 - WhatsApp SLA + overdue handoff escalation.
--
-- HUMAN HANDOFF -> WAITING -> SLA CLOCK -> OVERDUE -> ESCALATE ->
-- NEEDS ATTENTION -> HUMAN RESPONDS -> SLA RESOLVED.
--
-- Architecture (matches the Blueprint): a per-workspace SLA threshold on
-- the EXISTING workspace_settings, a scheduled sweep on the EXISTING
-- pg_cron+pg_net pattern, and raise/upgrade/resolve rows in the EXISTING
-- inbox_alerts (which already feeds Needs Attention). No new
-- notification/alert subsystem, no SLA policy engine, no escalation-tree
-- designer, no business-hours calendar. Elapsed-time SLA only;
-- business-hours-aware pausing is explicitly deferred (workspace_settings
-- already carries `timezone` for a later phase).
--
-- SLA start           = inbox_conversations.human_handoff_requested_at,
--                       only while status='human_handoff', ai_enabled=false,
--                       inbox_status<>'resolved'.
-- Qualifying response = a STAFF outbound message after the handoff started
--                       (last_staff_reply_at >= human_handoff_requested_at).
--                       Assignment alone is NOT a response.
-- Overdue             = sla enabled AND still needs a human AND not yet
--                       responded AND now()-start >= threshold.
-- Resolved            = staff replied | returned to AI | resolved | left
--                       human_handoff.

-- 1. workspace_settings: the smallest SLA config -------------------------

alter table public.workspace_settings
  add column if not exists handoff_sla_minutes integer not null default 10
    check (handoff_sla_minutes between 1 and 1440),
  add column if not exists handoff_sla_enabled boolean not null default true;

comment on column public.workspace_settings.handoff_sla_minutes is
  'Phase 5: minutes a human-handoff conversation may wait for a first staff response before StabiFlow flags it overdue (Needs Attention + inbox_alerts). Elapsed wall-clock time; business-hours pausing is a later phase.';

-- 2. inbox_alerts: the SLA alert type ---------------------------------

alter table public.inbox_alerts drop constraint if exists inbox_alerts_alert_type_check;
alter table public.inbox_alerts
  add constraint inbox_alerts_alert_type_check
  check (alert_type in ('human_handoff', 'customer_reply', 'high_priority', 'message_failed', 'handoff_sla_overdue'));

-- inbox_alerts_unique_open_conversation_idx (alert_type, conversation_id)
-- WHERE message_id is null and is_resolved = false already exists (Phase D)
-- and is exactly the idempotency invariant Phase 5 needs: at most ONE open
-- handoff_sla_overdue alert per conversation, forever.

-- 3. Sweep index - only open, human-handled, unresolved conversations ---

create index if not exists inbox_conversations_handoff_sla_idx
  on public.inbox_conversations (workspace_id, human_handoff_requested_at)
  where status = 'human_handoff' and ai_enabled = false and inbox_status <> 'resolved';

-- 4. Domain event taxonomy: conversation.handoff_sla_overdue ------------
-- Lets the EXISTING automation engine ACT (notify manager, reassign,
-- create notification) - the SLA system only DETECTS. Additive: every
-- prior value retained.

alter table public.domain_events drop constraint if exists domain_events_event_type_check;
alter table public.domain_events
  add constraint domain_events_event_type_check check (event_type in (
    'conversation.started', 'message.received', 'conversation.human_takeover',
    'conversation.intake_completed', 'conversation.handoff_sla_overdue',
    'lead.created', 'lead.qualified', 'lead.stage_changed', 'lead.idle_timeout',
    'opportunity.created', 'opportunity.stage_changed', 'opportunity.won', 'opportunity.lost',
    'customer.created', 'revenue.recorded',
    'content.published', 'content.publish_failed',
    'campaign.published', 'campaign.paused', 'campaign.performance_changed',
    'attribution.created',
    'flow_ai.analysis_completed'
  ));

alter table public.automations drop constraint if exists automations_trigger_event_type_check;
alter table public.automations
  add constraint automations_trigger_event_type_check check (trigger_event_type in (
    'conversation.started', 'message.received', 'conversation.human_takeover',
    'conversation.intake_completed', 'conversation.handoff_sla_overdue',
    'lead.created', 'lead.qualified', 'lead.stage_changed', 'lead.idle_timeout',
    'opportunity.created', 'opportunity.stage_changed', 'opportunity.won', 'opportunity.lost',
    'customer.created', 'revenue.recorded',
    'content.published', 'content.publish_failed',
    'campaign.published', 'campaign.paused', 'campaign.performance_changed',
    'attribution.created',
    'flow_ai.analysis_completed'
  ));

-- 5. sla_sweep() - the whole detection pass, set-based -----------------
-- SECURITY DEFINER, service-role-only in practice (called by the
-- whatsapp-sla-tick edge function). One statement per phase - no per-row
-- loop, no N+1. Every row carries its own workspace_id and joins its own
-- workspace_settings, so this is tenant-safe while processing all
-- workspaces in one pass. Bounded by SLA_RAISE_LIMIT.
--   - resolve stale open SLA alerts whose conversation recovered
--   - raise ONE new alert per newly-overdue conversation (idempotent via
--     the partial unique index) + emit conversation.handoff_sla_overdue
--     (deduped per handoff episode) + one workspace_activity_log row
--   - upgrade warning -> critical at 2x threshold (single transition)

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
  -- (a) RESOLVE STALE: the conversation no longer needs overdue
  -- intervention (staff replied since handoff | left handoff | resolved),
  -- OR the workspace has since turned SLA tracking off - either way the
  -- open alert must not linger as a permanently stale Needs Attention item.
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

  -- one recovery activity row per resolved episode (real audit value; not
  -- written every sweep - only when a row actually transitions).
  insert into public.workspace_activity_log (workspace_id, actor_user_id, action, target_type, target_id, metadata)
  select (r->>'workspace_id')::uuid, null, 'handoff_sla_resolved', 'inbox_conversation', (r->>'conversation_id')::uuid, '{}'::jsonb
  from jsonb_array_elements(v_resolved_rows) r;

  -- (b) RAISE: conversations now overdue with no open SLA alert.
  with overdue as (
    select c.id as conversation_id, c.workspace_id, c.human_handoff_requested_at as started_at,
           c.assigned_staff_id, coalesce(c.display_name, c.wa_id) as who,
           s.handoff_sla_minutes,
           (v_now - c.human_handoff_requested_at) >= make_interval(mins => s.handoff_sla_minutes * 2) as is_critical
    from public.inbox_conversations c
    join public.workspace_settings s on s.workspace_id = c.workspace_id
    where c.status = 'human_handoff'
      and c.ai_enabled = false
      and c.inbox_status <> 'resolved'
      and c.human_handoff_requested_at is not null
      and s.handoff_sla_enabled = true
      and (c.last_staff_reply_at is null or c.last_staff_reply_at < c.human_handoff_requested_at)
      and (v_now - c.human_handoff_requested_at) >= make_interval(mins => s.handoff_sla_minutes)
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
           case when o.is_critical then 'critical' else 'warning' end,
           'Customer waiting for a human response',
           o.who || ' has been waiting ' ||
             extract(epoch from (v_now - o.started_at))::int / 60 || ' min for a human reply (SLA ' || o.handoff_sla_minutes || ' min).',
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

  -- one domain event + one activity row per NEW overdue episode. Dedupe
  -- key is scoped to the handoff episode's start, so a fresh handoff after
  -- a prior resolution emits again.
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

  -- (c) UPGRADE: open warning-level SLA alert past 2x threshold -> critical
  -- (single transition; never downgrades).
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
      and (v_now - c.human_handoff_requested_at) >= make_interval(mins => s.handoff_sla_minutes * 2)
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
  'Phase 5: one idempotent, set-based pass that resolves recovered SLA alerts, raises one handoff_sla_overdue inbox_alert per newly-overdue human-handoff conversation (emitting conversation.handoff_sla_overdue + one activity row per episode), and upgrades warning->critical at 2x threshold. Called by the whatsapp-sla-tick edge function (service role) every minute. No client should call it.';

revoke execute on function public.sla_sweep() from public;
revoke execute on function public.sla_sweep() from anon;
revoke execute on function public.sla_sweep() from authenticated;
grant execute on function public.sla_sweep() to service_role;

-- 6. Schedule whatsapp-sla-tick (pg_cron + pg_net, mirrors
--    20260912060300_schedule_automations_tick.sql). The shared secret is
--    generated here in Vault and must be read out and set as the
--    WHATSAPP_SLA_CRON_SECRET edge function secret via `supabase secrets
--    set` as a separate, uncommitted deploy step. Until then the scheduled
--    POST just gets a 403 and nothing happens - safe to schedule early.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'whatsapp_sla_cron_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'whatsapp_sla_cron_secret');
  end if;
end
$$;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'whatsapp-sla-tick' limit 1;
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
exception
  when undefined_table or invalid_schema_name then
    null;
end
$$;

select cron.schedule(
  'whatsapp-sla-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://doarqrjpadejksovxeev.supabase.co/functions/v1/whatsapp-sla-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_sla_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

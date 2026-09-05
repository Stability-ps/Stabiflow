-- Phase 9 - WhatsApp outbound retry + dead-letter reliability.
--
-- Every outbound send path (staff reply, approved template, Inbox AI, Ask
-- Info, request_document, automation send_whatsapp_template) already routes
-- through the shared provider seam and records delivery_status on the ONE
-- logical inbox_messages row. This migration makes a *transient* provider
-- failure on that row recoverable, and a *permanent* / policy failure
-- explicitly dead-lettered:
--
--   attempt -> classify -> retryable ? schedule bounded backoff
--                        : dead-letter (permanent / policy / exhausted)
--   one global tick worker claims due rows atomically (FOR UPDATE SKIP
--   LOCKED), re-runs EVERY outbound safety gate, sends once, records the
--   outcome. A delivery callback (sent/delivered/read) always wins and
--   cancels any pending retry. No parallel outbound-message table, no
--   queue infra, no per-message cron.

-- 1. inbox_messages: retry / dead-letter state on the same logical row ---
-- template_id + template_parameters are needed so a template retry can
-- re-fetch the authoritative template and re-send the SAME parameters (a
-- retry must never trust a stale payload or silently switch templates).

alter table public.inbox_messages
  add column if not exists retry_count integer not null default 0 check (retry_count >= 0),
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_retry_at timestamptz,
  add column if not exists retry_claimed_at timestamptz,
  add column if not exists last_failure_code text,
  add column if not exists last_failure_category text,
  add column if not exists dead_lettered_at timestamptz,
  add column if not exists dead_letter_reason text,
  add column if not exists template_id uuid references public.whatsapp_message_templates(id) on delete set null,
  add column if not exists template_parameters text[];

comment on column public.inbox_messages.dead_lettered_at is
  'Phase 9: set when StabiFlow will no longer AUTOMATICALLY attempt this outbound delivery (retry limit exhausted, permanent provider error, retry became policy-blocked, or an ambiguous provider-acceptance state). A dead_lettered row raises ONE message_failed alert; staff can trigger a manual retry which clears it only if a fresh attempt is actually made.';

-- Worker candidate lookup: due, not dead-lettered, not currently claimed.
create index if not exists inbox_messages_retry_due_idx
  on public.inbox_messages (next_retry_at)
  where next_retry_at is not null and dead_lettered_at is null;

-- 2. message_failed alert now fires on DEAD-LETTER, not every transient ---
-- failure. A retryable failure that will be auto-recovered must not scream
-- at staff; only a dead-lettered message needs human attention (mission +
-- Needs Attention section of the spec). Re-creates the shared trigger
-- function and re-points the update trigger at dead_lettered_at.

create or replace function public.handle_inbox_message_operations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation public.inbox_conversations%rowtype;
begin
  select * into v_conversation from public.inbox_conversations where id = new.conversation_id;

  if new.direction = 'inbound' and v_conversation.status = 'human_handoff' and v_conversation.ai_enabled = false then
    update public.inbox_conversations
    set inbox_status = case when assigned_staff_id is null then 'unassigned' else 'assigned' end,
        updated_at = greatest(updated_at, new.created_at)
    where id = new.conversation_id and inbox_status <> 'resolved';

    insert into public.inbox_alerts (workspace_id, conversation_id, alert_type, severity, title, body, message_id, assigned_staff_id)
    values (new.workspace_id, new.conversation_id, 'customer_reply', 'info', 'Customer replied during human control', coalesce(v_conversation.display_name, v_conversation.wa_id) || ' sent a new message.', new.id, v_conversation.assigned_staff_id)
    on conflict do nothing;
  end if;

  if new.direction = 'outbound' and new.sender_type = 'staff' then
    update public.inbox_conversations
    set first_staff_reply_at = coalesce(first_staff_reply_at, new.created_at)
    where id = new.conversation_id;
  end if;

  -- Phase 9: alert + domain event ONLY once the message is dead-lettered
  -- (no more automatic attempts). Existing partial unique index on
  -- (alert_type, message_id) keeps the alert to one row per message; the
  -- domain_events dedupe_key keeps the event to one per message.
  if new.direction = 'outbound' and new.dead_lettered_at is not null then
    insert into public.inbox_alerts (workspace_id, conversation_id, alert_type, severity, title, body, message_id, assigned_staff_id)
    values (new.workspace_id, new.conversation_id, 'message_failed', 'critical', 'Message could not be delivered', 'StabiFlow stopped trying to deliver this outbound message. Open the conversation to review or retry.', new.id, v_conversation.assigned_staff_id)
    on conflict do nothing;

    insert into public.domain_events (workspace_id, event_type, entity_type, entity_id, payload, dedupe_key)
    values (new.workspace_id, 'message.delivery_failed', 'inbox_conversation', new.conversation_id,
            jsonb_build_object('entity_id', new.conversation_id, 'conversation_id', new.conversation_id, 'message_id', new.id,
                               'message_type', new.message_type, 'attempts', new.retry_count + 1, 'reason', new.dead_letter_reason),
            'message.delivery_failed:' || new.id)
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_inbox_message_delivery_alerts on public.inbox_messages;
create trigger trg_inbox_message_delivery_alerts
after update of dead_lettered_at on public.inbox_messages
for each row
when (new.dead_lettered_at is not null and old.dead_lettered_at is distinct from new.dead_lettered_at)
execute function public.handle_inbox_message_operations();

-- 3. message.delivery_failed - one domain event, on DEAD-LETTER only ----
-- Lets the existing automation engine react (WHEN message.delivery_failed
-- THEN notify) without the reliability worker hardcoding any action.
-- Additive: list mirrors the Phase-8 re-add plus the one new value.

alter table public.domain_events drop constraint if exists domain_events_event_type_check;
alter table public.domain_events
  add constraint domain_events_event_type_check check (event_type in (
    'conversation.started', 'message.received', 'conversation.human_takeover',
    'conversation.intake_completed', 'conversation.handoff_sla_overdue',
    'conversation.document_received', 'conversation.ai_limit_reached',
    'conversation.idle_timeout', 'conversation.priority_changed',
    'message.delivery_failed',
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
    'conversation.document_received', 'conversation.ai_limit_reached',
    'conversation.idle_timeout', 'conversation.priority_changed',
    'message.delivery_failed',
    'lead.created', 'lead.qualified', 'lead.stage_changed', 'lead.idle_timeout',
    'opportunity.created', 'opportunity.stage_changed', 'opportunity.won', 'opportunity.lost',
    'customer.created', 'revenue.recorded',
    'content.published', 'content.publish_failed',
    'campaign.published', 'campaign.paused', 'campaign.performance_changed',
    'attribution.created',
    'flow_ai.analysis_completed'
  ));

-- 4. claim_whatsapp_retry_batch() - atomic candidate claim -------------
-- Two workers must never claim the same row. FOR UPDATE SKIP LOCKED on the
-- inner select + a single UPDATE ... RETURNING = at most one owner. A
-- claim older than 5 minutes (crashed worker) is reclaimable. Per-workspace
-- fairness: at most 5 rows per workspace per tick, so a broken workspace
-- cannot starve the rest.

create or replace function public.claim_whatsapp_retry_batch(p_limit integer default 20)
returns table (
  id uuid, workspace_id uuid, conversation_id uuid, retry_count integer,
  message_type text, content text, sender_type text,
  template_id uuid, template_parameters text[],
  provider_message_id text, delivery_status text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select m.id
    from public.inbox_messages m
    where m.direction = 'outbound'
      and m.delivery_status = 'failed'
      and m.dead_lettered_at is null
      and m.provider_message_id is null
      and m.next_retry_at is not null
      and m.next_retry_at <= now()
      and (m.retry_claimed_at is null or m.retry_claimed_at < now() - interval '5 minutes')
    order by m.next_retry_at asc
    limit greatest(p_limit, 1) * 4
    for update skip locked
  ),
  ranked as (
    select d.id, row_number() over (
      partition by m.workspace_id order by m.next_retry_at asc
    ) as rn
    from due d join public.inbox_messages m on m.id = d.id
  ),
  claimed as (
    update public.inbox_messages m
    set retry_claimed_at = now()
    from ranked r
    where m.id = r.id and r.rn <= 5
    returning m.id, m.workspace_id, m.conversation_id, m.retry_count,
              m.message_type, m.content, m.sender_type,
              m.template_id, m.template_parameters,
              m.provider_message_id, m.delivery_status
  )
  select * from claimed limit greatest(p_limit, 1);
end;
$$;

revoke execute on function public.claim_whatsapp_retry_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_retry_batch(integer) to service_role;

-- 5. apply_whatsapp_retry_outcome() - the delivery state machine -------
-- Called by the retry worker after ONE provider attempt (and by
-- retry_message for a manual attempt). Pure transition on the SAME logical
-- row - never a new message, never a new automation_run. A delivery
-- callback that already advanced the row (submitted/sent/delivered/read or
-- a known provider_message_id) always wins: the outcome is ignored and any
-- pending retry is cancelled. Backoff schedule MUST match outboundRetry.ts.

create or replace function public.apply_whatsapp_retry_outcome(
  p_message_id uuid,
  p_outcome text,                       -- 'success' | 'retryable' | 'permanent' | 'policy_blocked'
  p_failure_code text default null,
  p_failure_category text default null,
  p_provider_message_id text default null,
  p_source text default 'retry_worker',
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.inbox_messages%rowtype;
  v_next integer;
  v_delay_seconds integer;
  v_final text;
begin
  select * into v_msg from public.inbox_messages where id = p_message_id for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  -- Callback / prior acceptance wins - cancel any pending retry, never
  -- downgrade a delivered/read message.
  if v_msg.delivery_status in ('submitted', 'sent', 'delivered', 'read')
     or (v_msg.provider_message_id is not null and p_outcome <> 'success') then
    update public.inbox_messages
      set next_retry_at = null, retry_claimed_at = null
      where id = p_message_id;
    return jsonb_build_object('result', 'already_accepted', 'delivery_status', v_msg.delivery_status);
  end if;

  if v_msg.dead_lettered_at is not null then
    return jsonb_build_object('result', 'already_dead_lettered');
  end if;

  if p_outcome = 'success' then
    update public.inbox_messages
      set delivery_status = 'submitted',
          provider_message_id = coalesce(p_provider_message_id, provider_message_id),
          retry_count = retry_count + 1,
          last_retry_at = now(),
          next_retry_at = null,
          retry_claimed_at = null,
          last_failure_code = null,
          last_failure_category = null
      where id = p_message_id;
    update public.inbox_alerts
      set is_resolved = true, resolved_at = now(), resolved_by = p_actor
      where message_id = p_message_id and alert_type = 'message_failed' and is_resolved = false;
    insert into public.workspace_activity_log (workspace_id, actor_user_id, action, target_type, target_id, metadata)
    values (v_msg.workspace_id, p_actor, 'whatsapp_retry_succeeded', 'inbox_conversation', v_msg.conversation_id,
            jsonb_build_object('message_id', p_message_id, 'attempt', v_msg.retry_count + 1, 'source', p_source));
    return jsonb_build_object('result', 'succeeded');
  end if;

  if p_outcome = 'retryable' then
    v_next := v_msg.retry_count + 1;
    if v_next >= 3 then
      update public.inbox_messages
        set retry_count = v_next, last_retry_at = now(), retry_claimed_at = null,
            last_failure_code = p_failure_code, last_failure_category = p_failure_category,
            next_retry_at = null,
            dead_lettered_at = now(), dead_letter_reason = 'retry_limit_exhausted'
        where id = p_message_id;
      insert into public.workspace_activity_log (workspace_id, actor_user_id, action, target_type, target_id, metadata)
      values (v_msg.workspace_id, p_actor, 'whatsapp_message_dead_lettered', 'inbox_conversation', v_msg.conversation_id,
              jsonb_build_object('message_id', p_message_id, 'attempt', v_next, 'reason', 'retry_limit_exhausted', 'source', p_source));
      return jsonb_build_object('result', 'dead_lettered', 'reason', 'retry_limit_exhausted');
    end if;
    -- backoff: 60 / 300 / 900 seconds + deterministic jitter (v_next * 7) % 30
    v_delay_seconds := (case least(v_next, 3) when 1 then 60 when 2 then 300 else 900 end) + ((v_next * 7) % 30);
    update public.inbox_messages
      set retry_count = v_next, last_retry_at = now(), retry_claimed_at = null,
          last_failure_code = p_failure_code, last_failure_category = p_failure_category,
          next_retry_at = now() + make_interval(secs => v_delay_seconds)
      where id = p_message_id;
    insert into public.workspace_activity_log (workspace_id, actor_user_id, action, target_type, target_id, metadata)
    values (v_msg.workspace_id, p_actor, 'whatsapp_retry_scheduled', 'inbox_conversation', v_msg.conversation_id,
            jsonb_build_object('message_id', p_message_id, 'attempt', v_next, 'delay_seconds', v_delay_seconds, 'source', p_source));
    return jsonb_build_object('result', 'retry_scheduled', 'attempt', v_next, 'delay_seconds', v_delay_seconds);
  end if;

  -- 'permanent' | 'policy_blocked' (or any unknown outcome -> treat as permanent)
  v_final := case when p_outcome = 'policy_blocked' then 'policy_blocked' else 'permanent_failure' end;
  update public.inbox_messages
    set last_retry_at = now(), retry_claimed_at = null, next_retry_at = null,
        last_failure_code = p_failure_code, last_failure_category = p_failure_category,
        dead_lettered_at = now(), dead_letter_reason = coalesce(p_failure_code, v_final)
    where id = p_message_id;
  insert into public.workspace_activity_log (workspace_id, actor_user_id, action, target_type, target_id, metadata)
  values (v_msg.workspace_id, p_actor, 'whatsapp_message_dead_lettered', 'inbox_conversation', v_msg.conversation_id,
          jsonb_build_object('message_id', p_message_id, 'attempt', v_msg.retry_count + 1, 'reason', coalesce(p_failure_code, v_final), 'source', p_source));
  return jsonb_build_object('result', 'dead_lettered', 'reason', v_final);
end;
$$;

revoke execute on function public.apply_whatsapp_retry_outcome(uuid, text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.apply_whatsapp_retry_outcome(uuid, text, text, text, text, text, uuid) to service_role;

-- 6. Schedule whatsapp-outbound-retry-tick (mirrors
--    20260923060000_whatsapp_sla_escalation.sql). Shared secret generated
--    in Vault; must be read out and set as WHATSAPP_RETRY_CRON_SECRET via
--    `supabase secrets set` (uncommitted deploy step). Until then the
--    scheduled POST just 403s - safe to schedule early.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'whatsapp_retry_cron_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'whatsapp_retry_cron_secret');
  end if;
end
$$;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'whatsapp-outbound-retry-tick' limit 1;
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
exception
  when undefined_table or invalid_schema_name then
    null;
end
$$;

select cron.schedule(
  'whatsapp-outbound-retry-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://doarqrjpadejksovxeev.supabase.co/functions/v1/whatsapp-outbound-retry-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'whatsapp_retry_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

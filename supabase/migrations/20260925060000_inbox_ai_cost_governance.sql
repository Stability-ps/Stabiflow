-- Phase 7 - Inbox AI cost governance + workspace usage caps.
--
-- WhatsApp Inbox AI now checks a per-workspace MONTHLY token allowance
-- before every OpenAI call. Over the cap -> no OpenAI call, no fabricated
-- reply, the conversation moves to the existing human-handoff path, and
-- one inbox_alert records why. Everything reuses StabiFlow's existing
-- Flow AI usage/cost architecture:
--   * usage is derived from the EXISTING ai_usage_events ledger
--     (feature = 'whatsapp_inbox_ai'), no second mutable counter
--   * the cap lives in the EXISTING workspace_billing.limits jsonb, right
--     beside flow_ai_monthly_token_limit, owner-editable via the same
--     manage_billing gate
--   * the platform-wide daily ceiling (FLOW_AI_PLATFORM_DAILY_TOKEN_CEILING)
--     already aggregates every feature - Inbox AI already contributes; the
--     webhook now also honours it
--   * month boundary = UTC calendar month start, identical to
--     flow-ai-chat's startOfMonthIso()
--
-- No new table, no subscription/billing plans, no per-user / per-conversation
-- / per-number budgets. Enforcement is a SOFT ceiling checked before each
-- call (the same contract Flow AI uses) - see inboxAiBudget.ts for the
-- bounded-overshoot note.

-- 1. inbox_alerts: the cap-reached operational signal -------------------
-- One unresolved alert per conversation while it is paused for the cap
-- (dedup via the existing partial unique index
--  inbox_alerts_unique_open_conversation_idx). Feeds Needs Attention.

alter table public.inbox_alerts drop constraint if exists inbox_alerts_alert_type_check;
alter table public.inbox_alerts
  add constraint inbox_alerts_alert_type_check
  check (alert_type in ('human_handoff', 'customer_reply', 'high_priority', 'message_failed', 'handoff_sla_overdue', 'ai_usage_limit_reached'));

-- 2. Automation taxonomy: conversation.ai_limit_reached ----------------
-- The cost-governance layer DETECTS; the existing automation engine ACTS
-- (e.g. WHEN ai limit reached THEN notify the workspace owner). Additive:
-- the list mirrors the Phase-6 re-add plus the one new value.

alter table public.domain_events drop constraint if exists domain_events_event_type_check;
alter table public.domain_events
  add constraint domain_events_event_type_check check (event_type in (
    'conversation.started', 'message.received', 'conversation.human_takeover',
    'conversation.intake_completed', 'conversation.handoff_sla_overdue',
    'conversation.document_received', 'conversation.ai_limit_reached',
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
    'lead.created', 'lead.qualified', 'lead.stage_changed', 'lead.idle_timeout',
    'opportunity.created', 'opportunity.stage_changed', 'opportunity.won', 'opportunity.lost',
    'customer.created', 'revenue.recorded',
    'content.published', 'content.publish_failed',
    'campaign.published', 'campaign.paused', 'campaign.performance_changed',
    'attribution.created',
    'flow_ai.analysis_completed'
  ));

-- 3. Hot-path index -----------------------------------------------------
-- The workspace usage sum runs on every AI-eligible inbound turn:
--   sum(total_tokens) where workspace_id = $1 and feature = $2
--                       and created_at >= <utc month start>
-- The existing ai_usage_events_workspace_created_idx (workspace_id,
-- created_at desc) already bounds it to one workspace-month, but once a
-- workspace runs several AI features this adds the feature equality to the
-- index so the sum never touches other features' rows.

create index if not exists ai_usage_events_workspace_feature_created_idx
  on public.ai_usage_events (workspace_id, feature, created_at desc);

-- 4. set_workspace_inbox_ai_cap(workspace, cap) -----------------------
-- The only write path for the cap. SECURITY DEFINER + an explicit
-- manage_billing check (owner-only, exactly the gate the Flow AI cap
-- already sits behind) so a raw client PATCH of workspace_billing.limits
-- can't be used to clobber sibling keys. p_cap NULL removes the override
-- (workspace falls back to the platform/env default). Bounds: 1 ..
-- 1,099,511,627,776 (2^40) - positive, and far below bigint overflow.

create or replace function public.set_workspace_inbox_ai_cap(p_workspace_id uuid, p_cap bigint default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limits jsonb;
begin
  if not public.has_workspace_permission(p_workspace_id, 'manage_billing') then
    raise exception 'Not authorized to change AI usage limits for this workspace' using errcode = '42501';
  end if;
  if p_cap is not null and (p_cap < 1 or p_cap > 1099511627776) then
    raise exception 'Inbox AI monthly token cap must be between 1 and 1099511627776' using errcode = '22003';
  end if;

  insert into public.workspace_billing (workspace_id) values (p_workspace_id)
  on conflict (workspace_id) do nothing;

  if p_cap is null then
    update public.workspace_billing
      set limits = limits - 'whatsapp_inbox_ai_monthly_token_limit'
      where workspace_id = p_workspace_id
      returning limits into v_limits;
  else
    update public.workspace_billing
      set limits = jsonb_set(coalesce(limits, '{}'::jsonb), '{whatsapp_inbox_ai_monthly_token_limit}', to_jsonb(p_cap), true)
      where workspace_id = p_workspace_id
      returning limits into v_limits;
  end if;

  return nullif(v_limits ->> 'whatsapp_inbox_ai_monthly_token_limit', '')::bigint;
end;
$$;

revoke execute on function public.set_workspace_inbox_ai_cap(uuid, bigint) from public;
revoke execute on function public.set_workspace_inbox_ai_cap(uuid, bigint) from anon;
grant execute on function public.set_workspace_inbox_ai_cap(uuid, bigint) to authenticated;

comment on function public.set_workspace_inbox_ai_cap(uuid, bigint) is
  'Phase 7: sets workspace_billing.limits->whatsapp_inbox_ai_monthly_token_limit (NULL clears the override -> platform/env default applies). manage_billing only. Never touches ai_usage_events.';

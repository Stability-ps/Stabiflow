-- Phase 11 - WhatsApp Analytics & Operational Performance.
--
-- ONE additive read-model RPC. No new source-of-truth table, no
-- materialized view, no warehouse. Every number is derived from
-- authoritative state Phases 2-10 already persist:
--   inbox_conversations.created_at            -> conversation start
--   inbox_conversations.human_handoff_requested_at
--                                             -> the Phase-5 human-response
--                                                SLA clock start
--   inbox_conversations.resolved_at           -> authoritative resolution
--                                                (written by inbox-actions
--                                                'resolve', cleared by
--                                                'reopen')
--   inbox_conversations.intake_schema_id      -> Phase-3 pinned schema
--   inbox_conversations.intake_completed_at   -> Phase-3 one-shot, race-safe
--                                                completion stamp
--   inbox_messages.direction / sender_type    -> AI ('ai') vs human ('staff')
--                                                vs system ('system', which
--                                                INCLUDES Phase-8 automation
--                                                sends) vs customer inbound
--
-- This is the OPERATIONAL surface (volume, response/resolution times,
-- handoff + intake rates, AI-vs-human split). It does NOT duplicate the
-- Phase-H business/conversion RPC public.get_whatsapp_analytics
-- (conversations -> leads -> qualified -> customers), which is left
-- untouched and still powers the card on /app/analytics.
--
-- ============ METRIC DEFINITIONS (authoritative) ============
--
-- Date range: half-open UTC instants [p_date_from, p_date_to). The client
-- resolves it from a workspace-timezone preset (last 7/30/90 days). A
-- conversation is "in the period" when created_at is in that range; a
-- message when its created_at is.
--
-- Cohort C = conversations with workspace_id = p_workspace_id and
-- created_at in [from, to). EVERY rate/time below is computed over this
-- fixed started-in-period cohort, so a conversation is counted once no
-- matter how many messages, handoffs or episodes it has.
--
--  1. conversations_started      = count(C)
--  2. inbound_messages           = inbox_messages, direction='inbound', in
--                                  range (voice notes included as ordinary
--                                  inbound; no content returned)
--  3. median_human_response_seconds
--       Sample: C rows where human_handoff_requested_at is not null AND
--       in range AND a staff outbound message exists at/after it.
--       Value  = min(staff outbound created_at at/after handoff)
--                - human_handoff_requested_at   (seconds)
--       Metric = percentile_cont(0.5); NULL if the sample set is empty.
--       AI ('ai'), system ('system', incl. automation sends) and template
--       auto-delivery never start/stop this clock. One sample per
--       conversation (the min), so repeated staff messages never create
--       multiple first-response samples.
--     human_response_sample_size = size of that sample set.
--  4. handoff_rate               = count(C where human_handoff_requested_at
--                                  is not null) / count(C); NULL when
--                                  count(C) = 0. Conversation-level: the
--                                  boolean is per-conversation, so repeated
--                                  handoff episodes count once.
--     conversations_with_handoff = the numerator.
--  5. median_resolution_seconds
--       Sample: C rows where resolved_at is not null and
--               resolved_at >= created_at.
--       Value  = resolved_at - created_at (seconds).
--       Metric = percentile_cont(0.5); NULL when no C row has a valid
--       resolved_at (unknown != zero; unresolved conversations are simply
--       absent, never counted as 0).
--     conversations_resolved     = size of that sample set.
--  6. intake_completion_rate
--       Denominator intake_applicable = count(C where intake_schema_id is
--         not null)  -- a structured-intake schema was actually pinned.
--       Numerator   intake_completed  = count(C where intake_schema_id is
--         not null AND intake_completed_at is not null)  -- authoritative
--         one-shot stamp; the conversation.intake_completed domain event is
--         NOT used, so duplicate events cannot inflate the rate.
--       intake_completion_rate = numerator / denominator; NULL (-> "N/A")
--       when denominator = 0.
--  7. AI-vs-human handling: a mutually-exclusive partition of C using only
--     human_handoff_requested_at and per-conversation lifetime counts of
--     outbound sender_type='ai' (ai_out) and sender_type='staff'
--     (staff_out). Categories (they sum to conversations_started):
--       handled_ai_only        : ai_out>0 AND staff_out=0 AND not handed off
--       handled_human_assisted : handed off OR (ai_out>0 AND staff_out>0)
--       handled_human_only     : staff_out>0 AND ai_out=0 AND not handed off
--       handled_no_agent_reply : ai_out=0 AND staff_out=0 AND not handed off
--     Automation sends are sender_type='system' -> never ai_out/staff_out,
--     so an automation never makes a conversation "AI" or "human". A
--     staff-triggered template is sender_type='staff' -> human.
--
-- Any median/rate that is NULL is rendered by the client as "-" / "Not
-- enough data", never 0. The RPC returns integers, ratios and second-
-- counts only: no message body, transcript, media path, phone number,
-- wa_id, name or id.
--
-- Workspace isolation: has_workspace_permission(p_workspace_id,
-- 'inbox.view') resolves auth.uid() internally, so a browser-supplied
-- p_workspace_id the caller is not an inbox member of returns NOTHING -
-- never another workspace's data. 'inbox.view' is the authoritative
-- permission for "can see this workspace's WhatsApp conversations" (the
-- same gate as the WhatsApp section itself); no new permission is added.

-- 1. Index for the started-in-period cohort scan ----------------------
create index if not exists inbox_conversations_workspace_created_idx
  on public.inbox_conversations (workspace_id, created_at);

-- 2. The RPC ---------------------------------------------------------
create or replace function public.get_whatsapp_operational_analytics(
  p_workspace_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz
)
returns table (
  conversations_started bigint,
  inbound_messages bigint,
  median_human_response_seconds bigint,
  human_response_sample_size bigint,
  conversations_with_handoff bigint,
  handoff_rate numeric,
  median_resolution_seconds bigint,
  conversations_resolved bigint,
  intake_applicable bigint,
  intake_completed bigint,
  intake_completion_rate numeric,
  handled_ai_only bigint,
  handled_human_assisted bigint,
  handled_human_only bigint,
  handled_no_agent_reply bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_workspace_permission(p_workspace_id, 'inbox.view') then
    return;
  end if;

  return query
  with cohort as (
    select
      c.id,
      c.created_at,
      c.human_handoff_requested_at,
      c.resolved_at,
      c.intake_schema_id,
      c.intake_completed_at
    from public.inbox_conversations c
    where c.workspace_id = p_workspace_id
      and c.created_at >= p_date_from
      and c.created_at <  p_date_to
  ),
  agent_replies as (
    select
      m.conversation_id,
      count(*) filter (where m.sender_type = 'ai')    as ai_out,
      count(*) filter (where m.sender_type = 'staff') as staff_out
    from public.inbox_messages m
    where m.workspace_id = p_workspace_id
      and m.direction = 'outbound'
      and m.conversation_id in (select id from cohort)
    group by m.conversation_id
  ),
  human_response as (
    select
      co.id,
      extract(epoch from (min(m.created_at) - co.human_handoff_requested_at)) as response_seconds
    from cohort co
    join public.inbox_messages m
      on  m.conversation_id = co.id
      and m.workspace_id = p_workspace_id
      and m.direction = 'outbound'
      and m.sender_type = 'staff'
      and m.created_at >= co.human_handoff_requested_at
    where co.human_handoff_requested_at is not null
    group by co.id, co.human_handoff_requested_at
  ),
  handling as (
    select
      co.id,
      coalesce(ar.ai_out, 0)    as ai_out,
      coalesce(ar.staff_out, 0) as staff_out,
      (co.human_handoff_requested_at is not null) as handed_off
    from cohort co
    left join agent_replies ar on ar.conversation_id = co.id
  )
  select
    (select count(*) from cohort)::bigint,
    (select count(*)
       from public.inbox_messages m
      where m.workspace_id = p_workspace_id
        and m.direction = 'inbound'
        and m.created_at >= p_date_from
        and m.created_at <  p_date_to)::bigint,
    (select percentile_cont(0.5) within group (order by response_seconds) from human_response)::bigint,
    (select count(*) from human_response)::bigint,
    (select count(*) from cohort where human_handoff_requested_at is not null)::bigint,
    (select case
              when count(*) = 0 then null
              else round(count(*) filter (where human_handoff_requested_at is not null)::numeric / count(*), 4)
            end
       from cohort)::numeric,
    (select percentile_cont(0.5) within group (order by extract(epoch from (resolved_at - created_at)))
       from cohort
      where resolved_at is not null and resolved_at >= created_at)::bigint,
    (select count(*) from cohort where resolved_at is not null and resolved_at >= created_at)::bigint,
    (select count(*) from cohort where intake_schema_id is not null)::bigint,
    (select count(*) from cohort where intake_schema_id is not null and intake_completed_at is not null)::bigint,
    (select case
              when count(*) filter (where intake_schema_id is not null) = 0 then null
              else round(
                count(*) filter (where intake_schema_id is not null and intake_completed_at is not null)::numeric
                / count(*) filter (where intake_schema_id is not null), 4)
            end
       from cohort)::numeric,
    (select count(*) from handling where ai_out > 0 and staff_out = 0 and not handed_off)::bigint,
    (select count(*) from handling where handed_off or (ai_out > 0 and staff_out > 0))::bigint,
    (select count(*) from handling where staff_out > 0 and ai_out = 0 and not handed_off)::bigint,
    (select count(*) from handling where ai_out = 0 and staff_out = 0 and not handed_off)::bigint;
end;
$$;

comment on function public.get_whatsapp_operational_analytics(uuid, timestamptz, timestamptz) is
  'Phase 11: workspace-scoped WhatsApp OPERATIONAL analytics for conversations STARTED in [p_date_from, p_date_to) - volume, median human-response time (Phase-5 handoff->staff-reply semantics), conversation-level handoff rate, median resolution time (authoritative resolved_at), Phase-3 structured-intake completion rate, and a mutually-exclusive AI/human/handed-off/no-reply handling split. Returns aggregates only (no message content, transcript, media path or PII). NULL rate/time = "unknown", never 0. Gated on has_workspace_permission(inbox.view); does NOT duplicate get_whatsapp_analytics (business/conversion).';

revoke all on function public.get_whatsapp_operational_analytics(uuid, timestamptz, timestamptz) from public;
grant execute on function public.get_whatsapp_operational_analytics(uuid, timestamptz, timestamptz) to authenticated;

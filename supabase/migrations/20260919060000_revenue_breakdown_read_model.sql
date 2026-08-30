-- Phase 1 (Revenue Operations) - ONE read-model function.
--
-- WHY A MIGRATION IS REQUIRED HERE (the rest of Phase 1 is zero-migration):
-- "Revenue by source" and "AI-assisted vs human-assisted revenue" both
-- require joining revenue_events to attribution_events / leads /
-- inbox_conversations / inbox_messages. Done client-side that is one query
-- per revenue event (get_touch_summary is per-entity), which does not
-- scale. Campaign-level revenue and the attributed/unattributed split are
-- already covered by get_campaign_performance / get_analytics_kpis, and
-- revenue-over-time is a trivial client-side group-by - so this function
-- deliberately covers ONLY the two dimensions that genuinely need SQL,
-- plus 'day' for a single consistent data source behind the Revenue view.
--
-- Conventions copied verbatim from 20260908060000_analytics_read_models.sql:
-- `stable`, `security definer`, `set search_path = public`; returns nothing
-- (never raises) on a missing permission; money is a per-currency jsonb
-- array, NEVER summed across currencies; a zero is a real fact.
--
-- Permissions: reuses view_analytics AND revenue.view (exactly what
-- get_analytics_kpis already requires for its revenue fields). No new
-- permission, no new table, no RLS policy change.

create or replace function public.get_revenue_breakdown(
  p_workspace_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_dimension text default 'source'
)
returns table (bucket_key text, bucket_label text, revenue jsonb, event_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_workspace_permission(p_workspace_id, 'view_analytics') then
    return;
  end if;
  if not public.has_workspace_permission(p_workspace_id, 'revenue.view') then
    return;
  end if;
  if p_dimension not in ('source', 'assist', 'day') then
    raise exception 'p_dimension must be one of source, assist, day' using errcode = '22023';
  end if;

  if p_dimension = 'day' then
    return query
      select b.d, b.d,
        jsonb_agg(jsonb_build_object('currency', b.currency, 'amount_minor', b.amt) order by b.currency),
        sum(b.cnt)::bigint
      from (
        select to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') as d,
               currency, sum(amount_minor) as amt, count(*) as cnt
        from public.revenue_events
        where workspace_id = p_workspace_id
          and occurred_at >= p_date_from and occurred_at < p_date_to
        group by 1, 2
      ) b
      group by b.d
      order by b.d;
    return;
  end if;

  if p_dimension = 'source' then
    return query
      with re as (
        select id, currency, amount_minor, customer_id, opportunity_id, lead_id
        from public.revenue_events
        where workspace_id = p_workspace_id
          and occurred_at >= p_date_from and occurred_at < p_date_to
      ),
      classified as (
        select re.currency, re.amount_minor,
          case
            when exists (
              select 1 from public.attribution_events ae
              where ae.workspace_id = p_workspace_id and ae.campaign_id is not null
                and ae.attribution_method in ('deterministic', 'exact_match')
                and (ae.customer_id = re.customer_id or ae.opportunity_id = re.opportunity_id or ae.lead_id = re.lead_id)
            ) then 'meta_direct'
            when exists (
              select 1 from public.attribution_events ae
              where ae.workspace_id = p_workspace_id and ae.source_type = 'paid'
                and (ae.customer_id = re.customer_id or ae.opportunity_id = re.opportunity_id or ae.lead_id = re.lead_id)
            ) then 'meta_inferred'
            when exists (
              select 1 from public.attribution_events ae
              where ae.workspace_id = p_workspace_id and ae.source_type = 'direct'
                and (ae.customer_id = re.customer_id or ae.opportunity_id = re.opportunity_id or ae.lead_id = re.lead_id)
            ) then 'whatsapp_direct'
            else 'unattributed'
          end as bucket
        from re
      )
      select g.bucket,
        case g.bucket
          when 'meta_direct' then 'Meta ad — direct match'
          when 'meta_inferred' then 'Meta ad — inferred (unmatched referral)'
          when 'whatsapp_direct' then 'Direct WhatsApp (organic)'
          else 'Unattributed (manual / unknown)'
        end,
        jsonb_agg(jsonb_build_object('currency', g.currency, 'amount_minor', g.amt) order by g.currency),
        sum(g.cnt)::bigint
      from (
        select bucket, currency, sum(amount_minor) as amt, count(*) as cnt
        from classified group by bucket, currency
      ) g
      group by g.bucket
      order by 4 desc;
    return;
  end if;

  -- p_dimension = 'assist': AI-assisted vs human-assisted vs no linked
  -- conversation. "human_assisted" whenever the linked conversation was
  -- ever handed to a human (human_handoff_requested_at set); "ai_assisted"
  -- only when it was NOT and the AI actually sent at least one message.
  return query
    with re as (
      select id, currency, amount_minor, customer_id, opportunity_id, lead_id
      from public.revenue_events
      where workspace_id = p_workspace_id
        and occurred_at >= p_date_from and occurred_at < p_date_to
    ),
    linked as (
      select re.currency, re.amount_minor,
        coalesce(
          (select l.created_from_conversation_id from public.leads l where l.id = re.lead_id),
          (select l.created_from_conversation_id from public.opportunities o join public.leads l on l.id = o.lead_id where o.id = re.opportunity_id),
          (select l.created_from_conversation_id from public.customers cu join public.leads l on l.id = cu.lead_id where cu.id = re.customer_id)
        ) as conversation_id
      from re
    ),
    classified as (
      select currency, amount_minor,
        case
          when conversation_id is null then 'no_conversation'
          when exists (
            select 1 from public.inbox_conversations co
            where co.id = conversation_id and co.human_handoff_requested_at is not null
          ) then 'human_assisted'
          when exists (
            select 1 from public.inbox_messages m
            where m.conversation_id = linked.conversation_id
              and m.direction = 'outbound' and m.sender_type = 'ai'
          ) then 'ai_assisted'
          else 'human_assisted'
        end as bucket
      from linked
    )
    select g.bucket,
      case g.bucket
        when 'ai_assisted' then 'AI-assisted journey'
        when 'human_assisted' then 'Human-assisted journey'
        else 'No linked conversation'
      end,
      jsonb_agg(jsonb_build_object('currency', g.currency, 'amount_minor', g.amt) order by g.currency),
      sum(g.cnt)::bigint
    from (
      select bucket, currency, sum(amount_minor) as amt, count(*) as cnt
      from classified group by bucket, currency
    ) g
    group by g.bucket
    order by 4 desc;
end;
$$;

comment on function public.get_revenue_breakdown(uuid, timestamptz, timestamptz, text) is
  'Recorded revenue (revenue_events - real cash, never opportunities.actual_value) for a date range, sliced by ONE dimension: source (meta_direct / meta_inferred / whatsapp_direct / unattributed, from attribution_events method + source_type), assist (AI-assisted vs human-assisted vs no-conversation, from the linked conversation''s human_handoff_requested_at + inbox_messages.sender_type), or day (time series). Requires view_analytics AND revenue.view. Money is per-currency and never summed across currencies. Campaign-level revenue lives in get_campaign_performance; the attributed/unattributed total split lives in get_analytics_kpis.';

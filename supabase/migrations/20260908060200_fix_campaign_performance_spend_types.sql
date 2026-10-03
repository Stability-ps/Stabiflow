-- get_campaign_performance declares spend_minor/impressions/reach/clicks as
-- bigint, but sum() over a bigint column returns numeric (Postgres widens
-- sum(bigint) to avoid overflow) - "structure of query does not match
-- function result type" (42804), "Returned type numeric does not match
-- expected type bigint". Fixed by casting each sum() back to bigint in the
-- spend CTE.

create or replace function public.get_campaign_performance(p_workspace_id uuid, p_date_from timestamptz, p_date_to timestamptz, p_attribution_model text default 'last_touch')
returns table (
  campaign_id uuid,
  name text,
  status text,
  currency text,
  spend_minor bigint,
  impressions bigint,
  reach bigint,
  clicks bigint,
  conversations bigint,
  leads bigint,
  qualified_leads bigint,
  opportunities bigint,
  customers bigint,
  revenue jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dir text;
  v_paid_filter text;
  v_can_see_revenue_sql text;
begin
  if not public.has_workspace_permission(p_workspace_id, 'view_analytics') then
    return;
  end if;
  if p_attribution_model not in ('first_touch', 'last_touch', 'first_paid_touch', 'last_paid_touch') then
    raise exception 'invalid attribution model: %', p_attribution_model using errcode = '22023';
  end if;
  v_dir := case when p_attribution_model in ('first_touch', 'first_paid_touch') then 'asc' else 'desc' end;
  v_paid_filter := case when p_attribution_model in ('first_paid_touch', 'last_paid_touch') then 'and source_type = ''paid''' else '' end;
  v_can_see_revenue_sql := case when public.has_workspace_permission(p_workspace_id, 'revenue.view') then 'true' else 'false' end;

  return query execute format($q$
    with events as (
      select * from public.attribution_events
      where workspace_id = $1 %1$s
    ),
    conv_credit as (
      select distinct on (conversation_id) conversation_id, campaign_id
      from events where conversation_id is not null
      order by conversation_id, occurred_at %2$s
    ),
    lead_credit as (
      select distinct on (lead_id) lead_id, campaign_id
      from events where lead_id is not null
      order by lead_id, occurred_at %2$s
    ),
    opp_credit as (
      select distinct on (opportunity_id) opportunity_id, campaign_id
      from events where opportunity_id is not null
      order by opportunity_id, occurred_at %2$s
    ),
    cust_credit as (
      select distinct on (customer_id) customer_id, campaign_id
      from events where customer_id is not null
      order by customer_id, occurred_at %2$s
    ),
    scoped_conversations as (
      select id from public.inbox_conversations where workspace_id = $1 and created_at >= $2 and created_at < $3
    ),
    scoped_leads as (
      select id, qualification_status from public.leads where workspace_id = $1 and created_at >= $2 and created_at < $3
    ),
    scoped_opportunities as (
      select id from public.opportunities where workspace_id = $1 and created_at >= $2 and created_at < $3
    ),
    scoped_customers as (
      select id from public.customers where workspace_id = $1 and customer_since >= $2 and customer_since < $3
    ),
    revenue_scoped as (
      select
        re.currency, re.amount_minor,
        coalesce(cuc.campaign_id, oc.campaign_id, lc.campaign_id) as credited_campaign_id
      from public.revenue_events re
      left join cust_credit cuc on cuc.customer_id = re.customer_id
      left join opp_credit oc on oc.opportunity_id = re.opportunity_id
      left join lead_credit lc on lc.lead_id = re.lead_id
      where re.workspace_id = $1 and re.occurred_at >= $2 and re.occurred_at < $3
    ),
    spend as (
      select campaign_id, currency,
        sum(spend_minor_units)::bigint as spend_minor, sum(impressions)::bigint as impressions,
        sum(reach)::bigint as reach, sum(clicks)::bigint as clicks
      from public.ad_campaign_metrics
      where workspace_id = $1 and date_start >= $2::date and date_start <= $3::date
      group by campaign_id, currency
    )
    select
      c.id, c.name, c.status::text, c.currency,
      coalesce(s.spend_minor, 0), coalesce(s.impressions, 0), coalesce(s.reach, 0), coalesce(s.clicks, 0),
      (select count(*) from scoped_conversations x join conv_credit cc on cc.conversation_id = x.id where cc.campaign_id = c.id),
      (select count(*) from scoped_leads x join lead_credit lc on lc.lead_id = x.id where lc.campaign_id = c.id),
      (select count(*) from scoped_leads x join lead_credit lc on lc.lead_id = x.id where lc.campaign_id = c.id and x.qualification_status = 'qualified'),
      (select count(*) from scoped_opportunities x join opp_credit oc on oc.opportunity_id = x.id where oc.campaign_id = c.id),
      (select count(*) from scoped_customers x join cust_credit cuc on cuc.customer_id = x.id where cuc.campaign_id = c.id),
      case when %3$s then coalesce((
        select jsonb_agg(jsonb_build_object('currency', currency, 'amount_minor', amt))
        from (select currency, sum(amount_minor) as amt from revenue_scoped where credited_campaign_id = c.id group by currency) rv
      ), '[]'::jsonb) else '[]'::jsonb end
    from public.ad_campaigns c
    left join spend s on s.campaign_id = c.id
    where c.workspace_id = $1
    order by coalesce(s.spend_minor, 0) desc, c.created_at desc
  $q$, v_paid_filter, v_dir, v_can_see_revenue_sql)
  using p_workspace_id, p_date_from, p_date_to;
end;
$$;

comment on function public.get_campaign_performance(uuid, timestamptz, timestamptz, text) is
  'Per-campaign performance for a date range under an explicit attribution model (first_touch/last_touch/first_paid_touch/last_paid_touch). Spend/impressions/reach/clicks come straight from ad_campaign_metrics; conversation/lead/qualified-lead/opportunity/customer counts and revenue are credited to exactly one campaign per entity per the selected model. ROAS is NOT computed here - the caller must check spend>0, revenue>0, single currency, and currency match before deriving it (see src/lib/analytics.ts).';

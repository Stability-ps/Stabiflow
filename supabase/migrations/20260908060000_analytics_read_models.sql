-- Phase H (Analytics & Reporting).
--
-- Read models only - no new source-of-truth tables. Every number here is
-- derived from data Content/Campaigns/Attribution/WhatsApp/Leads/
-- Opportunities/Customers/Revenue already persist (ad_campaign_metrics,
-- attribution_events, inbox_conversations, inbox_messages, leads,
-- opportunities, customers, revenue_events). Nothing is fabricated: a
-- metric with no underlying rows returns a real zero (a fact), and a
-- metric whose PRECONDITION isn't met (e.g. ROAS with no spend, or mixed
-- currencies) is left for the caller to render as "unavailable" - these
-- functions never manufacture a number to fill a gap.
--
-- Permission model: reuses the EXISTING view_analytics and revenue.view
-- permissions (Phase 2 and Phase G respectively) - no new permission was
-- necessary. Every function returns nothing at all without view_analytics,
-- and blanks revenue-specific fields without revenue.view (defense in
-- depth for a future role reconfiguration; every current role that has
-- view_analytics also already has revenue.view).
--
-- Currency safety: spend and revenue are NEVER summed across currencies.
-- Every money-bearing result is a jsonb array of {currency, amount_minor}
-- pairs - one element per currency actually present. The caller (frontend)
-- decides whether a single-currency result is safe to treat as "the"
-- total, or must render a mixed-currency state.
--
-- Date semantics (documented once, applies to every function below):
--   spend                -> ad_campaign_metrics.date_start (the provider's
--                            own metric date, never a sync/insertion time)
--   conversations         -> inbox_conversations.created_at
--   leads / qualified     -> leads.created_at
--   opportunities         -> opportunities.created_at
--   customers             -> customers.customer_since (the "became a
--                            customer" business event, not created_at)
--   revenue               -> revenue_events.occurred_at
-- All date-range filters are [p_date_from, p_date_to) half-open, in UTC -
-- the frontend is responsible for converting the workspace's timezone
-- (workspace_settings.timezone) date-picker selection into UTC instants
-- before calling these functions, exactly once, in one place.

-- 1. Executive KPIs ---------------------------------------------------------

create or replace function public.get_analytics_kpis(p_workspace_id uuid, p_date_from timestamptz, p_date_to timestamptz)
returns table (
  spend jsonb,
  conversations bigint,
  leads bigint,
  qualified_leads bigint,
  opportunities bigint,
  customers bigint,
  revenue_total jsonb,
  revenue_attributed jsonb,
  revenue_unattributed jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_workspace_permission(p_workspace_id, 'view_analytics') then
    return;
  end if;

  return query
  with spend_agg as (
    select currency, sum(spend_minor_units) as amount_minor
    from public.ad_campaign_metrics
    where workspace_id = p_workspace_id
      and date_start >= p_date_from::date and date_start <= p_date_to::date
    group by currency
  ),
  revenue_rows as (
    select
      re.currency,
      re.amount_minor,
      exists (
        select 1 from public.attribution_events ae
        where ae.workspace_id = p_workspace_id
          and ae.campaign_id is not null
          and (
            (re.customer_id is not null and ae.customer_id = re.customer_id) or
            (re.opportunity_id is not null and ae.opportunity_id = re.opportunity_id) or
            (re.lead_id is not null and ae.lead_id = re.lead_id)
          )
      ) as is_attributed
    from public.revenue_events re
    where re.workspace_id = p_workspace_id
      and re.occurred_at >= p_date_from and re.occurred_at < p_date_to
  ),
  revenue_agg as (
    select
      currency,
      sum(amount_minor) as total_minor,
      sum(amount_minor) filter (where is_attributed) as attributed_minor,
      sum(amount_minor) filter (where not is_attributed) as unattributed_minor
    from revenue_rows
    group by currency
  ),
  can_see_revenue as (
    select public.has_workspace_permission(p_workspace_id, 'revenue.view') as ok
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'amount_minor', amount_minor)) from spend_agg), '[]'::jsonb),
    (select count(*) from public.inbox_conversations where workspace_id = p_workspace_id and created_at >= p_date_from and created_at < p_date_to),
    (select count(*) from public.leads where workspace_id = p_workspace_id and created_at >= p_date_from and created_at < p_date_to),
    (select count(*) from public.leads where workspace_id = p_workspace_id and created_at >= p_date_from and created_at < p_date_to and qualification_status = 'qualified'),
    (select count(*) from public.opportunities where workspace_id = p_workspace_id and created_at >= p_date_from and created_at < p_date_to),
    (select count(*) from public.customers where workspace_id = p_workspace_id and customer_since >= p_date_from and customer_since < p_date_to),
    case when (select ok from can_see_revenue) then coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'amount_minor', total_minor)) from revenue_agg), '[]'::jsonb) else '[]'::jsonb end,
    case when (select ok from can_see_revenue) then coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'amount_minor', attributed_minor)) from revenue_agg where attributed_minor is not null and attributed_minor <> 0), '[]'::jsonb) else '[]'::jsonb end,
    case when (select ok from can_see_revenue) then coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'amount_minor', unattributed_minor)) from revenue_agg where unattributed_minor is not null and unattributed_minor <> 0), '[]'::jsonb) else '[]'::jsonb end;
end;
$$;

comment on function public.get_analytics_kpis(uuid, timestamptz, timestamptz) is
  'Workspace-scoped executive KPIs for a date range: spend/revenue as {currency, amount_minor} arrays (never silently summed across currencies), plus real conversation/lead/qualified-lead/opportunity/customer counts. Attribution-model-independent - "attributed" here means any real campaign evidence exists at all, not which specific campaign.';

-- 2. Campaign performance (attribution-model aware) --------------------------

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
  v_can_see_revenue boolean;
begin
  if not public.has_workspace_permission(p_workspace_id, 'view_analytics') then
    return;
  end if;
  if p_attribution_model not in ('first_touch', 'last_touch', 'first_paid_touch', 'last_paid_touch') then
    raise exception 'invalid attribution model: %', p_attribution_model using errcode = '22023';
  end if;
  v_dir := case when p_attribution_model in ('first_touch', 'first_paid_touch') then 'asc' else 'desc' end;
  v_paid_filter := case when p_attribution_model in ('first_paid_touch', 'last_paid_touch') then 'and source_type = ''paid''' else '' end;
  v_can_see_revenue := public.has_workspace_permission(p_workspace_id, 'revenue.view');

  return query execute format($q$
    with events as (
      select * from public.attribution_events
      where workspace_id = $1 %1$s
    ),
    -- "Credit" for a given entity under the selected model: exactly one
    -- campaign per entity id, resolved by first/last real touchpoint
    -- occurred_at - a multi-touched entity is credited to exactly one
    -- campaign per model, which is the whole point of the selector
    -- (different models CAN and SHOULD disagree on which campaign gets
    -- credit; neither is "more correct," see docs).
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
        sum(spend_minor_units) as spend_minor, sum(impressions) as impressions, sum(reach) as reach, sum(clicks) as clicks
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
  $q$, v_paid_filter, v_dir, v_can_see_revenue)
  using p_workspace_id, p_date_from, p_date_to;
end;
$$;

comment on function public.get_campaign_performance(uuid, timestamptz, timestamptz, text) is
  'Per-campaign performance for a date range under an explicit attribution model (first_touch/last_touch/first_paid_touch/last_paid_touch). Spend/impressions/reach/clicks come straight from ad_campaign_metrics; conversation/lead/qualified-lead/opportunity/customer counts and revenue are credited to exactly one campaign per entity per the selected model. ROAS is NOT computed here - the caller must check spend>0, revenue>0, single currency, and currency match before deriving it (see src/lib/analytics.ts).';

-- 3. Creative performance (Phase G deferred item) ----------------------------

create or replace function public.get_creative_performance(p_workspace_id uuid, p_date_from timestamptz, p_date_to timestamptz, p_attribution_model text default 'last_touch')
returns table (
  creative_id uuid,
  campaign_id uuid,
  campaign_name text,
  primary_text text,
  media_storage_path text,
  conversations bigint,
  leads bigint,
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
  v_can_see_revenue boolean;
begin
  if not public.has_workspace_permission(p_workspace_id, 'view_analytics') then
    return;
  end if;
  if p_attribution_model not in ('first_touch', 'last_touch', 'first_paid_touch', 'last_paid_touch') then
    raise exception 'invalid attribution model: %', p_attribution_model using errcode = '22023';
  end if;
  v_dir := case when p_attribution_model in ('first_touch', 'first_paid_touch') then 'asc' else 'desc' end;
  v_paid_filter := case when p_attribution_model in ('first_paid_touch', 'last_paid_touch') then 'and source_type = ''paid''' else '' end;
  v_can_see_revenue := public.has_workspace_permission(p_workspace_id, 'revenue.view');

  -- No spend/impressions/clicks here on purpose: ad_campaign_metrics is
  -- NEVER synced at ad/creative granularity (confirmed - the sync worker
  -- only ever writes campaign-level rows). Allocating campaign spend down
  -- to a creative would be a guess, which the brief explicitly forbids -
  -- so creative-level cost simply isn't offered, not estimated.
  return query execute format($q$
    with events as (
      select * from public.attribution_events
      where workspace_id = $1 %1$s
    ),
    conv_credit as (
      select distinct on (conversation_id) conversation_id, creative_id
      from events where conversation_id is not null and creative_id is not null
      order by conversation_id, occurred_at %2$s
    ),
    lead_credit as (
      select distinct on (lead_id) lead_id, creative_id
      from events where lead_id is not null and creative_id is not null
      order by lead_id, occurred_at %2$s
    ),
    cust_credit as (
      select distinct on (customer_id) customer_id, creative_id
      from events where customer_id is not null and creative_id is not null
      order by customer_id, occurred_at %2$s
    ),
    scoped_conversations as (
      select id from public.inbox_conversations where workspace_id = $1 and created_at >= $2 and created_at < $3
    ),
    scoped_leads as (
      select id from public.leads where workspace_id = $1 and created_at >= $2 and created_at < $3
    ),
    scoped_customers as (
      select id from public.customers where workspace_id = $1 and customer_since >= $2 and customer_since < $3
    ),
    revenue_scoped as (
      select re.currency, re.amount_minor, coalesce(cuc.creative_id, lc.creative_id) as credited_creative_id
      from public.revenue_events re
      left join cust_credit cuc on cuc.customer_id = re.customer_id
      left join lead_credit lc on lc.lead_id = re.lead_id
      where re.workspace_id = $1 and re.occurred_at >= $2 and re.occurred_at < $3
    )
    select
      cr.id, camp.id, camp.name, cr.primary_text, ma.storage_path,
      (select count(*) from scoped_conversations x join conv_credit cc on cc.conversation_id = x.id where cc.creative_id = cr.id),
      (select count(*) from scoped_leads x join lead_credit lc on lc.lead_id = x.id where lc.creative_id = cr.id),
      (select count(*) from scoped_customers x join cust_credit cuc on cuc.customer_id = x.id where cuc.creative_id = cr.id),
      case when %3$s then coalesce((
        select jsonb_agg(jsonb_build_object('currency', currency, 'amount_minor', amt))
        from (select currency, sum(amount_minor) as amt from revenue_scoped where credited_creative_id = cr.id group by currency) rv
      ), '[]'::jsonb) else '[]'::jsonb end
    from public.ad_creatives cr
    join public.ads ad on ad.creative_id = cr.id
    join public.ad_sets aset on aset.id = ad.ad_set_id
    join public.ad_campaigns camp on camp.id = aset.campaign_id
    left join public.content_media_assets ma on ma.id = cr.media_asset_id
    where cr.workspace_id = $1
    order by camp.created_at desc, cr.created_at desc
  $q$, v_paid_filter, v_dir, v_can_see_revenue)
  using p_workspace_id, p_date_from, p_date_to;
end;
$$;

comment on function public.get_creative_performance(uuid, timestamptz, timestamptz, text) is
  'Per-creative (that has actually been published as part of an ad) conversion counts and attributable revenue, under an explicit attribution model. No spend/impressions/clicks - ad_campaign_metrics is never synced at ad/creative granularity, so creative-level cost is deliberately left unavailable rather than allocated by guessing.';

-- 4. Lead-source breakdown ---------------------------------------------------
-- Always first-touch (not model-selectable): "where did this lead
-- ORIGINATE" is inherently a first-touch question, unrelated to the
-- campaign-crediting model used for performance reporting. A lead with no
-- attribution_events at all (created manually, or from an organic
-- WhatsApp message before Phase G's touchpoint recording covered every
-- path) is classified from its own leads.source field instead - never
-- forced into a bucket it doesn't belong to, and never dropped silently.

create or replace function public.get_lead_source_breakdown(p_workspace_id uuid, p_date_from timestamptz, p_date_to timestamptz)
returns table (source_label text, lead_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_workspace_permission(p_workspace_id, 'view_analytics') then
    return;
  end if;

  return query
  with first_touch as (
    select distinct on (lead_id) lead_id, source_type, source, attribution_source, platform
    from public.attribution_events
    where workspace_id = p_workspace_id and lead_id is not null
    order by lead_id, occurred_at asc
  ),
  classified as (
    select
      case
        when ft.source_type = 'paid' and ft.source = 'meta' then 'Meta Paid'
        when ft.platform = 'organic_facebook' then 'Facebook Organic'
        when ft.platform = 'organic_instagram' then 'Instagram Organic'
        when ft.source_type = 'direct' then 'Direct WhatsApp'
        when ft.attribution_source = 'referral' or l.source = 'referral' then 'Referral'
        when (ft.utm_source is not null) or l.source in ('website', 'google_later') then 'Website/UTM'
        when l.source in ('manual', 'other') then 'Manual'
        when l.source = 'whatsapp' and ft.lead_id is null then 'Direct WhatsApp'
        else 'Unknown'
      end as bucket
    from public.leads l
    left join first_touch ft on ft.lead_id = l.id
    where l.workspace_id = p_workspace_id and l.created_at >= p_date_from and l.created_at < p_date_to
  )
  select bucket, count(*) from classified group by bucket order by count(*) desc;
end;
$$;

comment on function public.get_lead_source_breakdown(uuid, timestamptz, timestamptz) is
  'Real, first-touch-based source classification for leads created in range. A lead with no attribution evidence at all falls back to its own leads.source field (manual/referral/website); never forced into a category it does not belong to.';

-- 5. WhatsApp analytics -------------------------------------------------------
-- Only metrics genuinely persisted and calculable are reported - no
-- invented response-time telemetry. leads.status = 'converted' is the
-- exact same flag leads-actions already sets the moment an opportunity
-- linked to that lead is won with a customer created, so "became a
-- customer" reuses real, already-authoritative state rather than
-- re-deriving it via a second join path that could disagree.

create or replace function public.get_whatsapp_analytics(p_workspace_id uuid, p_date_from timestamptz, p_date_to timestamptz)
returns table (
  conversations_started bigint,
  became_leads bigint,
  became_qualified bigint,
  became_customers bigint,
  ai_reply_count bigint,
  staff_reply_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_workspace_permission(p_workspace_id, 'view_analytics') then
    return;
  end if;

  return query
  with conv as (
    select id, lead_id from public.inbox_conversations
    where workspace_id = p_workspace_id and created_at >= p_date_from and created_at < p_date_to
  ),
  leads_j as (
    select l.qualification_status, l.status
    from conv c join public.leads l on l.id = c.lead_id
  )
  select
    (select count(*) from conv),
    (select count(*) from leads_j),
    (select count(*) from leads_j where qualification_status = 'qualified'),
    (select count(*) from leads_j where status = 'converted'),
    (select count(*) from public.inbox_messages where workspace_id = p_workspace_id and direction = 'outbound' and sender_type = 'ai' and created_at >= p_date_from and created_at < p_date_to),
    (select count(*) from public.inbox_messages where workspace_id = p_workspace_id and direction = 'outbound' and sender_type = 'staff' and created_at >= p_date_from and created_at < p_date_to);
end;
$$;

comment on function public.get_whatsapp_analytics(uuid, timestamptz, timestamptz) is
  'WhatsApp conversation-lifecycle metrics for conversations STARTED in the given range (not messages sent in range) - conversations_started, became_leads/became_qualified/became_customers (using leads.status=''converted'', the same authoritative flag leads-actions itself sets), and AI vs staff outbound reply counts. No response-time metric - not reliably calculable from persisted data without risking a misleading figure.';


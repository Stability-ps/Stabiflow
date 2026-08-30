-- Phase 1 (Revenue Operations) - read-model functions. No new tables, no
-- new columns, no RLS policy changes.
--
-- Three functions:
--   get_campaign_journey            - THE authoritative single-campaign
--                                    funnel + attribution-confidence split
--                                    + ad-set/ad/creative breakdown. Uses
--                                    the SAME crediting logic as
--                                    get_campaign_performance so the
--                                    numbers reconcile exactly.
--   get_campaign_journey_entities   - the real credited entity rows behind
--                                    one funnel stage, deterministically
--                                    ordered (created_at desc, id desc),
--                                    truly paginated (limit/offset).
--   get_revenue_breakdown          - recorded revenue for a date range,
--                                    returned in ONE call for all three
--                                    dimensions (source / assist / day) so
--                                    the Revenue view makes one round-trip
--                                    and revenue_events is range-scanned
--                                    once.
--
-- Conventions copied verbatim from 20260908060000_analytics_read_models.sql:
-- `stable`, `security definer`, `set search_path = public`; returns nothing
-- (never raises) on a missing permission; money is a per-currency jsonb
-- array, NEVER summed across currencies for display; a zero is a real fact
-- (and metrics_available distinguishes "measured 0" from "never synced").
--
-- Permissions (all reuse EXISTING permissions):
--   get_campaign_journey / _entities -> attribution.view
--     (+ per-entity view permission re-checked in _entities:
--        inbox.view / lead.view / opportunity.view)
--   get_revenue_breakdown            -> view_analytics AND revenue.view

-- ============================================================================
-- 1. get_campaign_journey
-- ============================================================================
-- Crediting is IDENTICAL to get_campaign_performance: for the selected
-- model, each entity (conversation / lead / opportunity / customer) is
-- credited to exactly one campaign via its first/last real touchpoint
-- (order by occurred_at asc/desc, paid models additionally filter
-- source_type = 'paid'). This function scopes that crediting to ONE
-- campaign, and additionally carries the crediting touchpoint's own
-- attribution_method and ad_set_id / ad_id / creative_id so the
-- direct-vs-inferred split and the structural breakdown are computed over
-- the SAME population as the funnel counts - they always reconcile.
--
--   *_direct   = credited entities whose crediting touchpoint method is
--                'deterministic' or 'exact_match' (a Meta referral matched
--                to a campaign published in StabiFlow)
--   *_inferred = every other credited entity (provider-reported / manual /
--                unknown method) - NEVER shown as deterministic
--   direct + inferred = the stage total, always.
--
--   adset/ad/creative breakdown: credited entities grouped by their
--   crediting touchpoint's ad_set_id / ad_id / creative_id. An entity whose
--   crediting touchpoint has a NULL ad_set_id (e.g. a manual attribution
--   override) is simply absent from that breakdown, so the breakdown rows
--   sum to <= the stage total; the caller shows the remainder.
--
-- All-time: the Campaign Journey has no date picker, so every credited
-- entity this campaign has EVER produced is counted (identical to the
-- Campaign Detail conversions widget's existing all-time semantics).
-- metrics_available is the honest "has Meta ever synced spend for this
-- campaign" flag - the caller renders "Not synced yet" (never "0") when it
-- is false.

create or replace function public.get_campaign_journey(
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_attribution_model text default 'last_touch'
)
returns table (
  campaign_id uuid,
  name text,
  status text,
  currency text,
  metrics_available boolean,
  spend_minor bigint,
  impressions bigint,
  reach bigint,
  clicks bigint,
  conversations bigint,
  conversations_direct bigint,
  conversations_inferred bigint,
  leads bigint,
  leads_direct bigint,
  leads_inferred bigint,
  qualified_leads bigint,
  opportunities bigint,
  opportunities_direct bigint,
  opportunities_inferred bigint,
  customers bigint,
  customers_direct bigint,
  customers_inferred bigint,
  revenue jsonb,
  adset_breakdown jsonb,
  ad_breakdown jsonb,
  creative_breakdown jsonb
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
  if not public.has_workspace_permission(p_workspace_id, 'attribution.view') then
    return;
  end if;
  if p_attribution_model not in ('first_touch', 'last_touch', 'first_paid_touch', 'last_paid_touch') then
    raise exception 'invalid attribution model: %', p_attribution_model using errcode = '22023';
  end if;
  -- The campaign must belong to this workspace - a caller with
  -- attribution.view in their own workspace cannot inspect a borrowed id.
  if not exists (select 1 from public.ad_campaigns where id = p_campaign_id and workspace_id = p_workspace_id) then
    return;
  end if;

  v_dir := case when p_attribution_model in ('first_touch', 'first_paid_touch') then 'asc' else 'desc' end;
  v_paid_filter := case when p_attribution_model in ('first_paid_touch', 'last_paid_touch') then 'and source_type = ''paid''' else '' end;
  v_can_see_revenue := public.has_workspace_permission(p_workspace_id, 'revenue.view');

  -- v_paid_filter / v_dir are SQL fragments (a predicate, a sort keyword)
  -- and must be interpolated into the text. v_can_see_revenue is a VALUE:
  -- it is bound as $3, never interpolated - a boolean rendered by
  -- format('%s', ...) becomes the bare token t/f, which SQL then reads as
  -- a column reference ("column t does not exist").
  return query execute format($q$
    with events as (
      select * from public.attribution_events
      where workspace_id = $1 %1$s
    ),
    -- one crediting touchpoint per entity - SAME order-by as
    -- get_campaign_performance (no extra tiebreaker, so the campaign
    -- credit is provably identical), carrying method + structural ids.
    conv_credit as (
      select distinct on (conversation_id) conversation_id, campaign_id, attribution_method, ad_set_id, ad_id, creative_id
      from events where conversation_id is not null
      order by conversation_id, occurred_at %2$s
    ),
    lead_credit as (
      select distinct on (lead_id) lead_id, campaign_id, attribution_method, ad_set_id, ad_id, creative_id
      from events where lead_id is not null
      order by lead_id, occurred_at %2$s
    ),
    opp_credit as (
      select distinct on (opportunity_id) opportunity_id, campaign_id, attribution_method, ad_set_id, ad_id, creative_id
      from events where opportunity_id is not null
      order by opportunity_id, occurred_at %2$s
    ),
    cust_credit as (
      select distinct on (customer_id) customer_id, campaign_id, attribution_method, ad_set_id, ad_id, creative_id
      from events where customer_id is not null
      order by customer_id, occurred_at %2$s
    ),
    -- Only entities that (a) belong to this workspace and (b) are credited
    -- to THIS campaign under the model. This is the funnel population; the
    -- split + breakdown are computed from exactly these rows.
    j_conv as (
      select cc.conversation_id as id, cc.attribution_method as m, cc.ad_set_id, cc.ad_id, cc.creative_id
      from conv_credit cc
      join public.inbox_conversations co on co.id = cc.conversation_id and co.workspace_id = $1
      where cc.campaign_id = $2
    ),
    j_lead as (
      select lc.lead_id as id, lc.attribution_method as m, lc.ad_set_id, lc.ad_id, lc.creative_id, l.qualification_status
      from lead_credit lc
      join public.leads l on l.id = lc.lead_id and l.workspace_id = $1
      where lc.campaign_id = $2
    ),
    j_opp as (
      select oc.opportunity_id as id, oc.attribution_method as m, oc.ad_set_id, oc.ad_id, oc.creative_id
      from opp_credit oc
      join public.opportunities o on o.id = oc.opportunity_id and o.workspace_id = $1
      where oc.campaign_id = $2
    ),
    j_cust as (
      select cuc.customer_id as id, cuc.attribution_method as m, cuc.ad_set_id, cuc.ad_id, cuc.creative_id
      from cust_credit cuc
      join public.customers cu on cu.id = cuc.customer_id and cu.workspace_id = $1
      where cuc.campaign_id = $2
    ),
    revenue_scoped as (
      select re.currency, re.amount_minor
      from public.revenue_events re
      where re.workspace_id = $1
        and (
          re.customer_id in (select id from j_cust) or
          re.opportunity_id in (select id from j_opp) or
          re.lead_id in (select id from j_lead)
        )
    ),
    metrics as (
      select
        count(*) > 0 as has_rows,
        -- sum() over a bigint column returns numeric; the RETURNS TABLE
        -- columns are bigint - cast so the row structure matches.
        coalesce(sum(spend_minor_units), 0)::bigint as spend_minor,
        coalesce(sum(impressions), 0)::bigint as impressions,
        coalesce(sum(reach), 0)::bigint as reach,
        coalesce(sum(clicks), 0)::bigint as clicks,
        max(currency) as metric_currency
      from public.ad_campaign_metrics
      where workspace_id = $1 and campaign_id = $2
    ),
    breakdown as (
      select
        coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
          select s.id,
            (select count(*) from j_conv where ad_set_id = s.id) as conversations,
            (select count(*) from j_lead where ad_set_id = s.id) as leads,
            (select count(*) from j_opp where ad_set_id = s.id) as opportunities,
            (select count(*) from j_cust where ad_set_id = s.id) as customers
          from (select distinct ad_set_id as id from (
            select ad_set_id from j_conv union all select ad_set_id from j_lead
            union all select ad_set_id from j_opp union all select ad_set_id from j_cust
          ) u where ad_set_id is not null) s
        ) x), '[]'::jsonb) as adset,
        coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
          select a.id,
            (select count(*) from j_conv where ad_id = a.id) as conversations,
            (select count(*) from j_lead where ad_id = a.id) as leads,
            (select count(*) from j_opp where ad_id = a.id) as opportunities,
            (select count(*) from j_cust where ad_id = a.id) as customers
          from (select distinct ad_id as id from (
            select ad_id from j_conv union all select ad_id from j_lead
            union all select ad_id from j_opp union all select ad_id from j_cust
          ) u where ad_id is not null) a
        ) x), '[]'::jsonb) as ad,
        coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
          select cr.id,
            (select count(*) from j_conv where creative_id = cr.id) as conversations,
            (select count(*) from j_lead where creative_id = cr.id) as leads,
            (select count(*) from j_opp where creative_id = cr.id) as opportunities,
            (select count(*) from j_cust where creative_id = cr.id) as customers
          from (select distinct creative_id as id from (
            select creative_id from j_conv union all select creative_id from j_lead
            union all select creative_id from j_opp union all select creative_id from j_cust
          ) u where creative_id is not null) cr
        ) x), '[]'::jsonb) as creative
    )
    select
      c.id, c.name, c.status::text, coalesce((select metric_currency from metrics), c.currency),
      (select has_rows from metrics),
      (select spend_minor from metrics), (select impressions from metrics),
      (select reach from metrics), (select clicks from metrics),
      (select count(*) from j_conv),
      (select count(*) from j_conv where m in ('deterministic','exact_match')),
      (select count(*) from j_conv where m is null or m not in ('deterministic','exact_match')),
      (select count(*) from j_lead),
      (select count(*) from j_lead where m in ('deterministic','exact_match')),
      (select count(*) from j_lead where m is null or m not in ('deterministic','exact_match')),
      (select count(*) from j_lead where qualification_status = 'qualified'),
      (select count(*) from j_opp),
      (select count(*) from j_opp where m in ('deterministic','exact_match')),
      (select count(*) from j_opp where m is null or m not in ('deterministic','exact_match')),
      (select count(*) from j_cust),
      (select count(*) from j_cust where m in ('deterministic','exact_match')),
      (select count(*) from j_cust where m is null or m not in ('deterministic','exact_match')),
      case when $3 then coalesce((
        select jsonb_agg(jsonb_build_object('currency', currency, 'amount_minor', amt) order by currency)
        from (select currency, sum(amount_minor) as amt from revenue_scoped group by currency) rv
      ), '[]'::jsonb) else '[]'::jsonb end,
      (select adset from breakdown),
      (select ad from breakdown),
      (select creative from breakdown)
    from public.ad_campaigns c
    where c.id = $2 and c.workspace_id = $1
  $q$, v_paid_filter, v_dir)
  using p_workspace_id, p_campaign_id, v_can_see_revenue;
end;
$$;

comment on function public.get_campaign_journey(uuid, uuid, text) is
  'THE authoritative single-campaign journey read model. Crediting is identical to get_campaign_performance (same order-by, same paid filter) so the funnel counts reconcile exactly. Returns: metrics_available (false = Meta has never synced spend for this campaign - the caller shows "Not synced yet", never "0"); spend/impressions/reach/clicks; conversation/lead/qualified-lead/opportunity/customer counts each split into direct (deterministic/exact_match crediting touchpoint) vs inferred (everything else - never shown as deterministic), direct+inferred=total; attributable revenue per currency; and ad-set/ad/creative breakdowns grouped by the crediting touchpoint''s structural ids (breakdown rows sum to <= the stage total; a credited entity whose crediting touchpoint has no ad set is absent from the breakdown). Cost-per-X / CAC / ROAS / conversion rates are the caller''s job - see src/lib/campaignJourney.ts.';

-- ============================================================================
-- 2. get_campaign_journey_entities
-- ============================================================================
-- The real credited entity rows behind one funnel stage. Same crediting
-- CTEs, scoped to this campaign. Deterministic display order
-- (created_at desc, id desc) so "showing the most recent N" is a true
-- statement, and truly paginated (limit <= 100, offset). Per-stage
-- permission is re-checked (defense in depth over attribution.view).

create or replace function public.get_campaign_journey_entities(
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_stage text,
  p_attribution_model text default 'last_touch',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  entity_id uuid,
  primary_label text,
  secondary_label text,
  status_label text,
  occurred_at timestamptz,
  attribution_method text,
  attribution_confidence text,
  lead_id uuid,
  opportunity_id uuid,
  customer_id uuid,
  conversation_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dir text;
  v_paid_filter text;
  v_lim integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.has_workspace_permission(p_workspace_id, 'attribution.view') then
    return;
  end if;
  if p_stage not in ('conversation', 'lead', 'qualified_lead', 'opportunity', 'customer') then
    raise exception 'p_stage must be one of conversation, lead, qualified_lead, opportunity, customer' using errcode = '22023';
  end if;
  if p_attribution_model not in ('first_touch', 'last_touch', 'first_paid_touch', 'last_paid_touch') then
    raise exception 'invalid attribution model: %', p_attribution_model using errcode = '22023';
  end if;
  if not exists (select 1 from public.ad_campaigns where id = p_campaign_id and workspace_id = p_workspace_id) then
    return;
  end if;
  if p_stage = 'conversation' and not public.has_workspace_permission(p_workspace_id, 'inbox.view') then return; end if;
  if p_stage in ('lead', 'qualified_lead') and not public.has_workspace_permission(p_workspace_id, 'lead.view') then return; end if;
  if p_stage in ('opportunity', 'customer') and not public.has_workspace_permission(p_workspace_id, 'opportunity.view') then return; end if;

  v_dir := case when p_attribution_model in ('first_touch', 'first_paid_touch') then 'asc' else 'desc' end;
  v_paid_filter := case when p_attribution_model in ('first_paid_touch', 'last_paid_touch') then 'and source_type = ''paid''' else '' end;

  return query execute format($q$
    with events as (
      select * from public.attribution_events where workspace_id = $1 %1$s
    ),
    conv_credit as (
      select distinct on (conversation_id) conversation_id, campaign_id, attribution_method, attribution_confidence
      from events where conversation_id is not null order by conversation_id, occurred_at %2$s
    ),
    lead_credit as (
      select distinct on (lead_id) lead_id, campaign_id, attribution_method, attribution_confidence
      from events where lead_id is not null order by lead_id, occurred_at %2$s
    ),
    opp_credit as (
      select distinct on (opportunity_id) opportunity_id, campaign_id, attribution_method, attribution_confidence
      from events where opportunity_id is not null order by opportunity_id, occurred_at %2$s
    ),
    cust_credit as (
      select distinct on (customer_id) customer_id, campaign_id, attribution_method, attribution_confidence
      from events where customer_id is not null order by customer_id, occurred_at %2$s
    )
    select entity_id, primary_label, secondary_label, status_label, occurred_at,
           attribution_method, attribution_confidence, lead_id, opportunity_id, customer_id, conversation_id
    from (
      select
        co.id as entity_id,
        coalesce(nullif(co.display_name, ''), co.phone_number) as primary_label,
        co.phone_number as secondary_label,
        co.inbox_status::text as status_label,
        co.created_at as occurred_at,
        cc.attribution_method, cc.attribution_confidence,
        co.lead_id, null::uuid as opportunity_id, null::uuid as customer_id, co.id as conversation_id
      from conv_credit cc
      join public.inbox_conversations co on co.id = cc.conversation_id and co.workspace_id = $1
      where $3 = 'conversation' and cc.campaign_id = $2

      union all
      select l.id, l.human_reference, coalesce(l.contact_name, l.company_name),
        (l.qualification_status || ' / ' || l.status), l.created_at,
        lc.attribution_method, lc.attribution_confidence,
        l.id, null, null, l.created_from_conversation_id
      from lead_credit lc
      join public.leads l on l.id = lc.lead_id and l.workspace_id = $1
      where $3 in ('lead', 'qualified_lead') and lc.campaign_id = $2
        and ($3 = 'lead' or l.qualification_status = 'qualified')

      union all
      select o.id, o.title, null, o.status, o.created_at,
        oc.attribution_method, oc.attribution_confidence,
        o.lead_id, o.id, null, null
      from opp_credit oc
      join public.opportunities o on o.id = oc.opportunity_id and o.workspace_id = $1
      where $3 = 'opportunity' and oc.campaign_id = $2

      union all
      select cu.id, cu.name, cu.company_name, 'customer', cu.customer_since,
        cuc.attribution_method, cuc.attribution_confidence,
        cu.lead_id, cu.opportunity_id, cu.id, null
      from cust_credit cuc
      join public.customers cu on cu.id = cuc.customer_id and cu.workspace_id = $1
      where $3 = 'customer' and cuc.campaign_id = $2
    ) rows
    order by rows.occurred_at desc, rows.entity_id desc
    limit $4 offset $5
  $q$, v_paid_filter, v_dir)
  using p_workspace_id, p_campaign_id, p_stage, v_lim, v_off;
end;
$$;

comment on function public.get_campaign_journey_entities(uuid, uuid, text, text, integer, integer) is
  'The actual conversation / lead / qualified_lead / opportunity / customer rows credited to one campaign under the selected attribution model - the exact population get_campaign_journey counts for that stage. Deterministically ordered (created_at desc, id desc) and truly paginated (limit<=100, offset). Per-stage permission re-checked; empty (never error) when the caller lacks the entity''s own view permission.';

-- ============================================================================
-- 3. get_revenue_breakdown - ONE call, all three dimensions
-- ============================================================================
-- source / assist / day in a single result set (dimension column) so the
-- Revenue view makes one round-trip and revenue_events is range-scanned
-- once. No p_dimension parameter any more.
--
-- REVENUE-EVENT SEMANTICS (documented gap): "Recorded revenue" here sums
-- EVERY revenue_events row in range - sale, payment, contract_value,
-- adjustment, refund - IDENTICAL to get_analytics_kpis. This can
-- double-count if a workspace records both a contract_value and the
-- payments against it. Separating contracted value from cash is a later
-- migration; Phase 1 stays consistent with the existing authoritative
-- figure rather than introducing a second revenue definition.
--
-- SOURCE bucket precedence (an event can match more than one; first wins):
--   1. meta_direct     - a crediting-quality Meta touchpoint exists:
--                        campaign_id set AND method in
--                        ('deterministic','exact_match'). This is a
--                        SUBSET of get_analytics_kpis.revenue_attributed
--                        (which counts any campaign_id link).
--   2. meta_inferred   - a paid Meta referral touchpoint exists
--                        (source_type='paid') but not a crediting-quality
--                        one. MAY have no campaign_id, so it is NOT
--                        campaign-attributed revenue - it is "evidence a
--                        paid ad was involved".
--   3. whatsapp_direct - a direct/organic touchpoint exists (source_type='direct').
--   4. unattributed    - no attribution_events evidence at all.
--
-- ASSIST buckets (revenue by conversation handling):
--   ai_only       - the linked conversation has AI outbound messages and
--                   NO human evidence.
--   human_only    - human evidence and NO AI outbound messages.
--   ai_and_human  - both (e.g. AI qualified, staff closed).
--   unknown       - a conversation is linked but neither signal is
--                   conclusive.
--   no_conversation - no WhatsApp conversation is linked to the revenue.
--   Human evidence = an outbound staff message, OR
--   human_handoff_requested_at set, OR assigned_staff_id set.

create or replace function public.get_revenue_breakdown(
  p_workspace_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz
)
returns table (dimension text, bucket_key text, bucket_label text, revenue jsonb, event_count bigint)
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

  return query
  with re as (
    select id, currency, amount_minor, customer_id, opportunity_id, lead_id, occurred_at
    from public.revenue_events
    where workspace_id = p_workspace_id
      and occurred_at >= p_date_from and occurred_at < p_date_to
  ),
  -- ---- source ----
  source_classified as (
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
  ),
  source_rows as (
    select 'source'::text as dimension, g.bucket as bucket_key,
      case g.bucket
        when 'meta_direct' then 'Confirmed Meta campaign'
        when 'meta_inferred' then 'Likely Meta ad (unmatched referral)'
        when 'whatsapp_direct' then 'Direct / organic WhatsApp'
        else 'No attribution evidence'
      end as bucket_label,
      jsonb_agg(jsonb_build_object('currency', g.currency, 'amount_minor', g.amt) order by g.currency) as revenue,
      sum(g.cnt)::bigint as event_count
    from (
      select bucket, currency, sum(amount_minor) as amt, count(*) as cnt
      from source_classified group by bucket, currency
    ) g
    group by g.bucket
  ),
  -- ---- assist ----
  linked as (
    select re.currency, re.amount_minor,
      coalesce(
        (select l.created_from_conversation_id from public.leads l where l.id = re.lead_id),
        (select l.created_from_conversation_id from public.opportunities o join public.leads l on l.id = o.lead_id where o.id = re.opportunity_id),
        (select l.created_from_conversation_id from public.customers cu join public.leads l on l.id = cu.lead_id where cu.id = re.customer_id)
      ) as conversation_id
    from re
  ),
  handled as (
    select li.currency, li.amount_minor, li.conversation_id,
      (li.conversation_id is not null and exists (
        select 1 from public.inbox_messages m
        where m.conversation_id = li.conversation_id and m.direction = 'outbound' and m.sender_type = 'ai'
      )) as ai_ev,
      (li.conversation_id is not null and (
        exists (
          select 1 from public.inbox_messages m
          where m.conversation_id = li.conversation_id and m.direction = 'outbound' and m.sender_type = 'staff'
        )
        or exists (
          select 1 from public.inbox_conversations co
          where co.id = li.conversation_id
            and (co.human_handoff_requested_at is not null or co.assigned_staff_id is not null)
        )
      )) as human_ev
    from linked li
  ),
  assist_classified as (
    select currency, amount_minor,
      case
        when conversation_id is null then 'no_conversation'
        when ai_ev and human_ev then 'ai_and_human'
        when ai_ev and not human_ev then 'ai_only'
        when human_ev and not ai_ev then 'human_only'
        else 'unknown'
      end as bucket
    from handled
  ),
  assist_rows as (
    select 'assist'::text as dimension, g.bucket as bucket_key,
      case g.bucket
        when 'ai_only' then 'AI only'
        when 'human_only' then 'Human only'
        when 'ai_and_human' then 'AI + Human'
        when 'unknown' then 'Unknown'
        else 'No linked conversation'
      end as bucket_label,
      jsonb_agg(jsonb_build_object('currency', g.currency, 'amount_minor', g.amt) order by g.currency) as revenue,
      sum(g.cnt)::bigint as event_count
    from (
      select bucket, currency, sum(amount_minor) as amt, count(*) as cnt
      from assist_classified group by bucket, currency
    ) g
    group by g.bucket
  ),
  -- ---- day ----
  day_rows as (
    select 'day'::text as dimension, d.day as bucket_key, d.day as bucket_label,
      jsonb_agg(jsonb_build_object('currency', d.currency, 'amount_minor', d.amt) order by d.currency) as revenue,
      sum(d.cnt)::bigint as event_count
    from (
      select to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') as day,
             currency, sum(amount_minor) as amt, count(*) as cnt
      from re group by 1, 2
    ) d
    group by d.day
  )
  select * from source_rows
  union all select * from assist_rows
  union all select * from day_rows;
end;
$$;

comment on function public.get_revenue_breakdown(uuid, timestamptz, timestamptz) is
  'Recorded revenue (revenue_events - sums EVERY event type, identical to get_analytics_kpis; contract_value vs cash separation is documented Phase-2 debt) for a date range, returned in ONE call for three dimensions (dimension column: source / assist / day). source = attribution evidence (meta_direct SUBSET of get_analytics_kpis.revenue_attributed; meta_inferred is "a paid ad was involved" and may have no campaign_id - NOT campaign-attributed; whatsapp_direct; unattributed). assist = revenue by conversation handling (ai_only / human_only / ai_and_human / unknown / no_conversation; human evidence = staff outbound message OR human_handoff_requested_at OR assigned_staff_id). day = daily time series. Requires view_analytics AND revenue.view. Money is per-currency, never summed across currencies. No ORDER BY - the caller sorts for display (single-currency by amount; otherwise by event count).';

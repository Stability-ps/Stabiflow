-- Phase 4 - Customer linking + Customer 360.
--
-- Goal: let StabiFlow recognise that the same person's WhatsApp
-- conversations, leads, opportunities, customer record, revenue, notes,
-- documents and campaign attribution all belong to ONE identity - without
-- creating a parallel CRM. Built entirely on the existing customers table
-- and its existing customer_id relationships (attribution_events,
-- revenue_events) plus one new nullable link on inbox_conversations.
--
-- No new contacts/customers system. No new attribution or revenue system.
-- No destructive merge. No fuzzy/AI identity scoring - matching is
-- deterministic evidence only.

-- 1. customers: additive identity fields ----------------------------------
-- phone_normalized: a deterministic, indexable match key ("+"+digits, >=7
--   digits, else null) computed as a STORED generated column - same shape
--   as leads.phone_normalized / inbox_conversations.phone_number, no
--   trigger, auto-populated for existing rows on ADD COLUMN.
-- status: minimal lifecycle for the Customer 360 identity header.
-- assigned_to: the account owner (PDF: "owner if applicable").

alter table public.customers
  add column if not exists phone_normalized text
    generated always as (
      case
        when length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) >= 7
          then '+' || regexp_replace(phone, '[^0-9]', '', 'g')
        else null
      end
    ) stored,
  add column if not exists status text not null default 'active'
    check (status in ('active', 'inactive', 'archived')),
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null;

create index if not exists customers_phone_normalized_idx
  on public.customers (workspace_id, phone_normalized) where phone_normalized is not null;
create index if not exists customers_email_lower_idx
  on public.customers (workspace_id, lower(email)) where email is not null;

-- assigned_to must be a member of the customer's workspace (defense in
-- depth, same posture as leads.assigned_to's check).
create or replace function public.customers_validate_workspace_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.lead_id is not null and not exists (
    select 1 from public.leads where id = new.lead_id and workspace_id = new.workspace_id
  ) then
    raise exception 'customers.lead_id must belong to the same workspace as the customer' using errcode = '23514';
  end if;

  if new.opportunity_id is not null and not exists (
    select 1 from public.opportunities where id = new.opportunity_id and workspace_id = new.workspace_id
  ) then
    raise exception 'customers.opportunity_id must belong to the same workspace as the customer' using errcode = '23514';
  end if;

  if new.assigned_to is not null and not exists (
    select 1 from public.workspace_members where workspace_id = new.workspace_id and user_id = new.assigned_to
  ) then
    raise exception 'customers.assigned_to must be a member of the customer''s workspace' using errcode = '23514';
  end if;

  return new;
end;
$$;

-- Small immutable helper so the RPCs and the whatsapp-webhook auto-link
-- share one phone normalisation with _shared/phone.ts (digits only, "+"
-- prefix, >= 7 digits, else null - never guesses at an incomplete number).
create or replace function public.normalize_phone_number(p_raw text)
returns text
language sql
immutable
as $$
  select case
    when length(regexp_replace(coalesce(p_raw, ''), '[^0-9]', '', 'g')) >= 7
      then '+' || regexp_replace(p_raw, '[^0-9]', '', 'g')
    else null
  end;
$$;

-- 2. inbox_conversations.customer_id - the conversation <-> customer link --
-- Nullable, ON DELETE SET NULL, workspace-consistency enforced by the
-- existing validate trigger (extended below). Never rewrites attribution.

alter table public.inbox_conversations
  add column if not exists customer_id uuid references public.customers(id) on delete set null;

create index if not exists inbox_conversations_customer_idx
  on public.inbox_conversations (customer_id) where customer_id is not null;

create or replace function public.inbox_conversations_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.workspace_whatsapp_numbers
    where id = new.whatsapp_number_id and workspace_id = new.workspace_id
  ) then
    raise exception 'inbox_conversations.workspace_id must match its whatsapp_number_id''s workspace' using errcode = '23514';
  end if;

  if new.customer_id is not null and not exists (
    select 1 from public.customers where id = new.customer_id and workspace_id = new.workspace_id
  ) then
    raise exception 'inbox_conversations.customer_id must belong to the same workspace as the conversation' using errcode = '23514';
  end if;

  return new;
end;
$$;

-- 3. Client write policy for the link ------------------------------------
-- customers themselves stay server-created (no change). The conversation
-- link is a staff action gated in inbox-actions (inbox.manage) using the
-- service role; the existing inbox_conversations_write policy (inbox.manage)
-- already covers any authenticated UPDATE path, and the validate trigger
-- above blocks a cross-workspace customer_id even on a direct service-role
-- write. Nothing to add here.

-- 4. customer_match_candidates(workspace, conversation) ------------------
-- Deterministic candidate finder for the "link customer" UI. SECURITY
-- DEFINER, gated on membership + opportunity.view (the permission customers
-- already read under). Returns each workspace-local customer that matches
-- the conversation on hard evidence, tagged with the tier and a
-- human-readable reason. NEVER auto-merges - the caller decides.

create or replace function public.customer_match_candidates(p_workspace_id uuid, p_conversation_id uuid)
returns table (
  customer_id uuid,
  name text,
  phone text,
  email text,
  company_name text,
  match_tier text,
  match_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_conv record;
begin
  if not public.is_workspace_member(p_workspace_id)
     or not public.has_workspace_permission(p_workspace_id, 'opportunity.view') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select c.id, c.workspace_id, c.phone_number, c.lead_id,
         nullif(lower(trim(l.email)), '') as lead_email,
         nullif(lower(trim(l.company_name)), '') as lead_company,
         nullif(lower(trim(coalesce(l.contact_name, c.display_name))), '') as contact_name
  into v_conv
  from public.inbox_conversations c
  left join public.leads l on l.id = c.lead_id
  where c.id = p_conversation_id and c.workspace_id = p_workspace_id;

  if v_conv.id is null then
    return; -- unknown / cross-workspace conversation -> no candidates
  end if;

  return query
  with base as (
    select cu.id, cu.name, cu.phone, cu.email, cu.company_name, cu.phone_normalized, cu.lead_id,
           nullif(lower(trim(cu.email)), '') as email_l,
           nullif(lower(trim(cu.company_name)), '') as company_l,
           nullif(lower(trim(cu.name)), '') as name_l
    from public.customers cu
    where cu.workspace_id = p_workspace_id
  ),
  scored as (
    select b.*,
      case
        when b.phone_normalized is not null and b.phone_normalized = public.normalize_phone_number(v_conv.phone_number) then 'exact'
        when b.email_l is not null and b.email_l = v_conv.lead_email then 'exact'
        when v_conv.lead_id is not null and b.lead_id = v_conv.lead_id then 'exact'
        when b.company_l is not null and b.company_l = v_conv.lead_company
             and b.name_l is not null and b.name_l = v_conv.contact_name then 'possible'
        else null
      end as tier
    from base b
  )
  select s.id, s.name, s.phone, s.email, s.company_name, s.tier,
    case
      when s.phone_normalized is not null and s.phone_normalized = public.normalize_phone_number(v_conv.phone_number)
        then 'Exact match - phone ' || s.phone_normalized
      when s.email_l is not null and s.email_l = v_conv.lead_email
        then 'Exact match - email ' || s.email
      when v_conv.lead_id is not null and s.lead_id = v_conv.lead_id
        then 'Exact match - this conversation''s lead is already this customer'
      else 'Possible match - same company and contact name'
    end as reason
  from scored s
  where s.tier is not null
  order by (s.tier = 'exact') desc, s.name;
end;
$$;

-- 5. customer_360(workspace, customer) --------------------------------
-- ONE compact read model for the Customer 360 page - avoids N+1 / giant
-- client joins. SECURITY DEFINER, gated on membership + opportunity.view +
-- the customer belonging to the workspace. Every section is already
-- workspace-scoped by its own FK chain; nested selects are bounded.
-- Returns a single jsonb document. Never exposes a storage_path (documents
-- carry ids only; signing stays in leads-actions under lead.attachment.view).

create or replace function public.customer_360(p_workspace_id uuid, p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cust record;
  v_lead_ids uuid[];
  v_opp_ids uuid[];
  v_conv_ids uuid[];
  result jsonb;
begin
  if not public.is_workspace_member(p_workspace_id)
     or not public.has_workspace_permission(p_workspace_id, 'opportunity.view') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_cust from public.customers
  where id = p_customer_id and workspace_id = p_workspace_id;
  if v_cust.id is null then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;

  -- Related leads: the originating lead + any workspace lead sharing the
  -- customer's normalised phone (deterministic only).
  select array_agg(distinct l.id) into v_lead_ids
  from public.leads l
  where l.workspace_id = p_workspace_id
    and (l.id = v_cust.lead_id
         or (v_cust.phone_normalized is not null and l.phone_normalized = v_cust.phone_normalized));

  v_lead_ids := coalesce(v_lead_ids, '{}');

  select array_agg(distinct o.id) into v_opp_ids
  from public.opportunities o
  where o.workspace_id = p_workspace_id
    and (o.id = v_cust.opportunity_id or o.lead_id = any(v_lead_ids));
  v_opp_ids := coalesce(v_opp_ids, '{}');

  select array_agg(distinct c.id) into v_conv_ids
  from public.inbox_conversations c
  where c.workspace_id = p_workspace_id
    and (c.customer_id = p_customer_id or c.lead_id = any(v_lead_ids));
  v_conv_ids := coalesce(v_conv_ids, '{}');

  result := jsonb_build_object(
    'identity', jsonb_build_object(
      'id', v_cust.id,
      'name', v_cust.name,
      'phone', v_cust.phone,
      'phone_normalized', v_cust.phone_normalized,
      'email', v_cust.email,
      'company_name', v_cust.company_name,
      'status', v_cust.status,
      'customer_since', v_cust.customer_since,
      'assigned_to', v_cust.assigned_to,
      'assigned_to_name', (select p.full_name from public.profiles p where p.id = v_cust.assigned_to),
      'created_at', v_cust.created_at
    ),
    'counts', jsonb_build_object(
      'conversations', coalesce(array_length(v_conv_ids, 1), 0),
      'leads', coalesce(array_length(v_lead_ids, 1), 0),
      'opportunities', coalesce(array_length(v_opp_ids, 1), 0),
      'open_opportunities', (select count(*) from public.opportunities o where o.id = any(v_opp_ids) and o.status = 'open')
    ),
    'conversations', coalesce((
      select jsonb_agg(row_to_json(x)) from (
        select c.id, c.wa_id, c.phone_number, c.display_name, c.status, c.ai_enabled,
               c.inbox_status, c.assigned_staff_name, c.last_inbound_at, c.last_outbound_at, c.updated_at,
               c.customer_id
        from public.inbox_conversations c
        where c.id = any(v_conv_ids)
        order by c.updated_at desc
        limit 50
      ) x
    ), '[]'::jsonb),
    'leads', coalesce((
      select jsonb_agg(row_to_json(x)) from (
        select l.id, l.human_reference, l.contact_name, l.status, l.qualification_status,
               l.source, l.source_detail, l.estimated_value, l.created_at,
               ps.name as stage_name, pl.name as pipeline_name,
               (select jsonb_build_object('campaign_id', ae.campaign_id, 'method', ae.source_type, 'confidence', ae.attribution_confidence)
                  from public.attribution_events ae where ae.lead_id = l.id order by ae.occurred_at asc limit 1) as attribution
        from public.leads l
        left join public.pipeline_stages ps on ps.id = l.pipeline_stage_id
        left join public.pipelines pl on pl.id = l.pipeline_id
        where l.id = any(v_lead_ids)
        order by l.created_at desc
        limit 50
      ) x
    ), '[]'::jsonb),
    'opportunities', coalesce((
      select jsonb_agg(row_to_json(x)) from (
        select o.id, o.title, o.status, o.estimated_value, o.actual_value, o.won_at, o.lost_at, o.created_at,
               ps.name as stage_name, pl.name as pipeline_name,
               (select p.full_name from public.profiles p where p.id = o.assigned_to) as owner_name
        from public.opportunities o
        left join public.pipeline_stages ps on ps.id = o.pipeline_stage_id
        left join public.pipelines pl on pl.id = o.pipeline_id
        where o.id = any(v_opp_ids)
        order by o.created_at desc
        limit 50
      ) x
    ), '[]'::jsonb),
    'revenue_by_currency', coalesce((
      select jsonb_agg(row_to_json(x)) from (
        select re.currency, sum(re.amount_minor)::bigint as total_minor, count(*)::int as event_count
        from public.revenue_events re
        where re.workspace_id = p_workspace_id
          and (re.customer_id = p_customer_id or re.opportunity_id = any(v_opp_ids) or re.lead_id = any(v_lead_ids))
        group by re.currency
        order by re.currency
      ) x
    ), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(row_to_json(x)) from (
        select a.id, a.media_filename, a.media_mime_type, a.media_size_bytes, a.source, a.received_at, a.lead_id, a.created_at
        from public.lead_attachments a
        where a.workspace_id = p_workspace_id and a.lead_id = any(v_lead_ids)
        order by a.created_at desc
        limit 100
      ) x
    ), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(row_to_json(x)) from (
        select n.id, n.target_type, n.target_id, n.author_name, n.body, n.created_at
        from public.crm_notes n
        where n.workspace_id = p_workspace_id
          and ((n.target_type = 'lead' and n.target_id = any(v_lead_ids))
            or (n.target_type = 'opportunity' and n.target_id = any(v_opp_ids)))
        order by n.created_at desc
        limit 50
      ) x
    ), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(row_to_json(x)) from (
        select al.id, al.action, al.target_type, al.target_id, al.actor_role, al.metadata, al.created_at,
               (select p.full_name from public.profiles p where p.id = al.actor_user_id) as actor_name
        from public.workspace_activity_log al
        where al.workspace_id = p_workspace_id
          and (al.target_id = p_customer_id
            or al.target_id = any(v_lead_ids)
            or al.target_id = any(v_opp_ids)
            or al.target_id = any(v_conv_ids))
        order by al.created_at desc
        limit 100
      ) x
    ), '[]'::jsonb),
    'attribution', (
      select jsonb_build_object('campaign_id', ae.campaign_id, 'method', ae.source_type,
                                'confidence', ae.attribution_confidence, 'platform', ae.platform,
                                'occurred_at', ae.occurred_at)
      from public.attribution_events ae
      where ae.workspace_id = p_workspace_id
        and (ae.customer_id = p_customer_id or ae.opportunity_id = any(v_opp_ids)
             or ae.lead_id = any(v_lead_ids) or ae.conversation_id = any(v_conv_ids))
      order by ae.occurred_at asc
      limit 1
    ),
    'timeline', coalesce((
      select jsonb_agg(row_to_json(t) order by t.at asc) from (
        select ae.occurred_at as at, 'touchpoint' as kind,
               coalesce('Touchpoint - ' || ae.platform, 'Touchpoint') as label
        from public.attribution_events ae
        where ae.workspace_id = p_workspace_id
          and (ae.customer_id = p_customer_id or ae.opportunity_id = any(v_opp_ids)
               or ae.lead_id = any(v_lead_ids) or ae.conversation_id = any(v_conv_ids))
        union all
        select c.created_at, 'conversation_started', 'WhatsApp conversation started'
        from public.inbox_conversations c where c.id = any(v_conv_ids)
        union all
        select l.created_at, 'lead_created', 'Lead ' || l.human_reference || ' created'
        from public.leads l where l.id = any(v_lead_ids)
        union all
        select o.created_at, 'opportunity_created', 'Opportunity "' || o.title || '" created'
        from public.opportunities o where o.id = any(v_opp_ids)
        union all
        select o.won_at, 'opportunity_won', 'Opportunity "' || o.title || '" won'
        from public.opportunities o where o.id = any(v_opp_ids) and o.won_at is not null
        union all
        select o.lost_at, 'opportunity_lost', 'Opportunity "' || o.title || '" lost'
        from public.opportunities o where o.id = any(v_opp_ids) and o.lost_at is not null
        union all
        select v_cust.created_at, 'customer_created', 'Customer record created'
        union all
        select re.occurred_at, 'revenue_recorded',
               'Revenue ' || re.currency || ' ' || round(re.amount_minor / 100.0, 2)::text || ' (' || re.event_type || ')'
        from public.revenue_events re
        where re.workspace_id = p_workspace_id
          and (re.customer_id = p_customer_id or re.opportunity_id = any(v_opp_ids) or re.lead_id = any(v_lead_ids))
      ) t
      where t.at is not null
    ), '[]'::jsonb)
  );

  return result;
end;
$$;

-- 6. customers_search(workspace, query, limit) --------------------------
-- Thin list backing for the Customers area: name / phone / email / company
-- ILIKE, plus per-customer opportunity + revenue rollups. opportunity.view
-- gated. Bounded.

create or replace function public.customers_search(p_workspace_id uuid, p_query text default null, p_limit int default 50)
returns table (
  id uuid, name text, phone text, email text, company_name text, status text,
  customer_since timestamptz, assigned_to_name text,
  open_opportunities int, total_opportunities int, last_interaction timestamptz,
  revenue_by_currency jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_like text;
  v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if not public.is_workspace_member(p_workspace_id)
     or not public.has_workspace_permission(p_workspace_id, 'opportunity.view') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_like := '%' || coalesce(trim(p_query), '') || '%';

  return query
  select cu.id, cu.name, cu.phone, cu.email, cu.company_name, cu.status, cu.customer_since,
    (select p.full_name from public.profiles p where p.id = cu.assigned_to) as assigned_to_name,
    (select count(*)::int from public.opportunities o where o.workspace_id = p_workspace_id
        and (o.id = cu.opportunity_id or o.lead_id = cu.lead_id) and o.status = 'open') as open_opportunities,
    (select count(*)::int from public.opportunities o where o.workspace_id = p_workspace_id
        and (o.id = cu.opportunity_id or o.lead_id = cu.lead_id)) as total_opportunities,
    greatest(
      cu.customer_since,
      (select max(c.updated_at) from public.inbox_conversations c
         where c.workspace_id = p_workspace_id and (c.customer_id = cu.id or c.lead_id = cu.lead_id))
    ) as last_interaction,
    coalesce((select jsonb_agg(jsonb_build_object('currency', r.currency, 'total_minor', r.total_minor))
      from (select re.currency, sum(re.amount_minor)::bigint as total_minor
            from public.revenue_events re
            where re.workspace_id = p_workspace_id
              and (re.customer_id = cu.id or re.opportunity_id = cu.opportunity_id or re.lead_id = cu.lead_id)
            group by re.currency) r), '[]'::jsonb) as revenue_by_currency
  from public.customers cu
  where cu.workspace_id = p_workspace_id
    and (coalesce(trim(p_query), '') = ''
      or cu.name ilike v_like or cu.phone ilike v_like or cu.email ilike v_like or cu.company_name ilike v_like)
  order by last_interaction desc nulls last
  limit v_lim;
end;
$$;

-- 7. Realtime already publishes inbox_conversations (Phase D). customers is
-- not on realtime and does not need to be for Phase 4.

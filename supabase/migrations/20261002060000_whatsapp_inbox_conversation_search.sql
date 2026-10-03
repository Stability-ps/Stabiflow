-- Phase 14 - WhatsApp Inbox server-side search / filter / keyset pagination.
--
-- Replaces the client-side `.limit(200)` + in-memory search/filter with one
-- authoritative, workspace-scoped, inbox.view-gated read model:
--
--   public.get_inbox_conversations(p_workspace_id, p_limit, cursor, filters...)
--
-- Deterministic keyset order (updated_at DESC, id DESC), caller-specific
-- unread state joined in, all filters/search composed in ONE query. No
-- OFFSET (conversation rows are frequently updated + realtime-active).
--
-- Scope is deliberately the proven operational gap only: search
-- (display_name / phone / wa_id), inbox_status, assignment, priority,
-- handling (AI vs human), unread. No message-body / transcript / intake /
-- CRM / tag / SLA search - those are documented follow-ups.

-- 1. pg_trgm for substring display_name search -------------------------
create extension if not exists pg_trgm;

-- 2. Deterministic keyset index (additive; the existing
--    (workspace_id, updated_at desc) index is left in place). -----------
create index if not exists inbox_conversations_workspace_updated_id_idx
  on public.inbox_conversations (workspace_id, updated_at desc, id desc);

-- 3. Substring search on display_name. Phone / wa_id search is a digit
--    substring match bounded by the workspace filter (short strings,
--    small per-workspace cardinality) - no dedicated index needed. ------
create index if not exists inbox_conversations_display_name_trgm_idx
  on public.inbox_conversations using gin (display_name gin_trgm_ops);

-- 4. The read model -------------------------------------------------------
create or replace function public.get_inbox_conversations(
  p_workspace_id uuid,
  p_limit integer default 50,
  p_cursor_updated_at timestamptz default null,
  p_cursor_id uuid default null,
  p_search text default null,
  p_inbox_status text default null,     -- 'unassigned'|'assigned'|'waiting_client'|'resolved'
  p_assignment text default null,       -- 'unassigned'|'assigned'|'staff'
  p_assigned_staff_id uuid default null,-- required when p_assignment = 'staff'
  p_priority text default null,         -- 'normal'|'high'|'urgent'
  p_handling text default null,         -- 'ai_active'|'human_attention'
  p_unread_only boolean default false
)
returns table (
  id uuid,
  wa_id text,
  phone_number text,
  display_name text,
  status text,
  ai_enabled boolean,
  inbox_status text,
  priority_level text,
  assigned_staff_id uuid,
  assigned_staff_name text,
  ai_summary text,
  intake_missing_fields text[],
  intake_payload jsonb,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  updated_at timestamptz,
  lead_id uuid,
  intake_schema_id uuid,
  intake_completed_at timestamptz,
  customer_id uuid,
  human_handoff_requested_at timestamptz,
  last_staff_reply_at timestamptz,
  is_unread boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_search_digits text := regexp_replace(coalesce(p_search, ''), '\D', '', 'g');
  -- normalise enum-ish inputs: an unrecognised value becomes "no filter"
  v_inbox_status text := case when p_inbox_status in ('new','unassigned','assigned','waiting_client','resolved') then p_inbox_status end;
  v_assignment   text := case when p_assignment in ('unassigned','assigned','staff') then p_assignment end;
  v_priority     text := case when p_priority in ('normal','high','urgent') then p_priority end;
  v_handling     text := case when p_handling in ('ai_active','human_attention') then p_handling end;
begin
  -- Explicit permission gate - not relying on SECURITY DEFINER alone.
  if not public.has_workspace_permission(p_workspace_id, 'inbox.view') then
    return;
  end if;

  -- A 'staff' assignment filter with no staff id selects nothing rather
  -- than silently degrading to "assigned".
  if v_assignment = 'staff' and p_assigned_staff_id is null then
    return;
  end if;

  return query
  select
    c.id, c.wa_id, c.phone_number, c.display_name, c.status, c.ai_enabled,
    c.inbox_status, c.priority_level, c.assigned_staff_id, c.assigned_staff_name,
    c.ai_summary, c.intake_missing_fields, c.intake_payload,
    c.last_inbound_at, c.last_outbound_at, c.updated_at,
    c.lead_id, c.intake_schema_id, c.intake_completed_at, c.customer_id,
    c.human_handoff_requested_at, c.last_staff_reply_at,
    (c.last_inbound_at is not null and (r.last_read_at is null or c.last_inbound_at > r.last_read_at)) as is_unread
  from public.inbox_conversations c
  left join public.inbox_conversation_reads r
    on r.conversation_id = c.id and r.staff_id = v_caller
  where c.workspace_id = p_workspace_id
    and (
      p_cursor_updated_at is null or p_cursor_id is null
      or (c.updated_at, c.id) < (p_cursor_updated_at, p_cursor_id)
    )
    and (v_inbox_status is null or c.inbox_status = v_inbox_status)
    and (v_priority is null or c.priority_level = v_priority)
    and (
      v_assignment is null
      or (v_assignment = 'unassigned' and c.assigned_staff_id is null)
      or (v_assignment = 'assigned'   and c.assigned_staff_id is not null)
      or (v_assignment = 'staff'      and c.assigned_staff_id = p_assigned_staff_id)
    )
    and (
      v_handling is null
      or (v_handling = 'ai_active'       and c.ai_enabled = true and c.status <> 'human_handoff')
      or (v_handling = 'human_attention' and (c.status = 'human_handoff' or c.ai_enabled = false))
    )
    and (
      not coalesce(p_unread_only, false)
      or (c.last_inbound_at is not null and (r.last_read_at is null or c.last_inbound_at > r.last_read_at))
    )
    and (
      v_search is null
      or c.display_name ilike '%' || v_search || '%'
      or (
        v_search_digits <> '' and (
          regexp_replace(c.phone_number, '\D', '', 'g') like '%' || v_search_digits || '%'
          or regexp_replace(c.wa_id, '\D', '', 'g') like '%' || v_search_digits || '%'
          -- operator types a local SA number (leading 0) for an
          -- international-format stored number (27...)
          or (left(v_search_digits, 1) = '0' and (
                regexp_replace(c.phone_number, '\D', '', 'g') like '%27' || substr(v_search_digits, 2) || '%'
             or regexp_replace(c.wa_id, '\D', '', 'g') like '%27' || substr(v_search_digits, 2) || '%'
          ))
        )
      )
    )
  order by c.updated_at desc, c.id desc
  limit v_limit;
end;
$$;

revoke all on function public.get_inbox_conversations(uuid, integer, timestamptz, uuid, text, text, text, uuid, text, text, boolean) from public;
grant execute on function public.get_inbox_conversations(uuid, integer, timestamptz, uuid, text, text, text, uuid, text, text, boolean) to authenticated;

comment on function public.get_inbox_conversations(uuid, integer, timestamptz, uuid, text, text, text, uuid, text, text, boolean) is
  'Phase 14: one page of WhatsApp Inbox conversations. inbox.view-gated, workspace-scoped, keyset paginated (updated_at DESC, id DESC), server-side search (display_name / phone / wa_id) + filters (inbox_status, assignment, priority, handling, unread). Caller-specific is_unread via inbox_conversation_reads. Client derives has_more (rows = p_limit) and next cursor (last row updated_at + id).';

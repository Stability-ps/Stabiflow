-- Phase 15 - compact recent-webhook diagnostics.
--
-- Gives an operator answering "WhatsApp says connected but messages
-- aren't appearing" a bounded (<=20) list of the most recent webhook
-- events and what happened after receipt, from the EXISTING
-- workspace_whatsapp_webhook_events ledger (no new table, no raw payload).
--
-- The whatsapp-webhook function now writes payload_summary =
--   { resolved: bool,
--     outcome: 'received'|'stored'|'duplicate'|'ignored_unsupported'
--              |'unresolved_number'|'processing_failed',
--     message_type?: 'text'|'image'|'document'|'voice'|'audio'|'unsupported' }
-- and NOTHING else (no body / wa_id / token / signature / headers).
--
-- Unresolved events (workspace_id IS NULL - a signed webhook for a
-- phone_number_id that isn't an ACTIVE StabiFlow number) stay invisible
-- via table RLS. This RPC surfaces one to a workspace ONLY when that
-- phone_number_id is provably one of the workspace's own discovered
-- numbers (workspace_whatsapp_numbers), so an operator can see "Meta is
-- delivering to +27... but that number isn't active here" - never another
-- tenant's unknown-number traffic.

-- Index for the unresolved branch (the resolved branch already has
-- workspace_whatsapp_webhook_events_workspace_idx). Partial + tiny:
-- workspace_id IS NULL rows are rare (a misconfigured number).
create index if not exists workspace_whatsapp_webhook_events_unresolved_idx
  on public.workspace_whatsapp_webhook_events (phone_number_id, received_at desc)
  where workspace_id is null;

create or replace function public.get_recent_whatsapp_webhook_events(
  p_workspace_id uuid,
  p_limit integer default 10
)
returns table (
  id uuid,
  received_at timestamptz,
  event_type text,
  phone_number_id text,
  resolved boolean,
  outcome text,
  message_type text,
  is_unresolved boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 20);
begin
  -- Same permission the WhatsApp connection diagnostics already use.
  if not public.has_workspace_permission(p_workspace_id, 'integration.view') then
    return;
  end if;

  return query
  with resolved_events as (
    select e.id, e.received_at, e.event_type, e.phone_number_id, e.payload_summary, false as is_unresolved
    from public.workspace_whatsapp_webhook_events e
    where e.workspace_id = p_workspace_id
    order by e.received_at desc
    limit v_limit
  ),
  unresolved_events as (
    select e.id, e.received_at, e.event_type, e.phone_number_id, e.payload_summary, true as is_unresolved
    from public.workspace_whatsapp_webhook_events e
    where e.workspace_id is null
      and exists (
        select 1 from public.workspace_whatsapp_numbers n
        where n.workspace_id = p_workspace_id
          and n.phone_number_id = e.phone_number_id
      )
    order by e.received_at desc
    limit v_limit
  ),
  merged as (
    select * from resolved_events
    union all
    select * from unresolved_events
  )
  select
    m.id,
    m.received_at,
    m.event_type,
    m.phone_number_id,
    coalesce((m.payload_summary->>'resolved')::boolean, not m.is_unresolved) as resolved,
    nullif(m.payload_summary->>'outcome', '') as outcome,
    nullif(m.payload_summary->>'message_type', '') as message_type,
    m.is_unresolved
  from merged m
  order by m.received_at desc
  limit v_limit;
end;
$$;

revoke all on function public.get_recent_whatsapp_webhook_events(uuid, integer) from public;
grant execute on function public.get_recent_whatsapp_webhook_events(uuid, integer) to authenticated;

comment on function public.get_recent_whatsapp_webhook_events(uuid, integer) is
  'Phase 15: last <=20 WhatsApp webhook events for a workspace (integration.view-gated) - received_at, event_type, phone_number_id, resolved, bounded outcome, optional message_type. Includes workspace_id IS NULL (unresolved) rows ONLY when phone_number_id is one of the workspace''s discovered numbers. Never returns message content or payload_summary wholesale.';

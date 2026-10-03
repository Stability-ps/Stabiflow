-- Fixes a real bug found while testing 20260830060000: inbox_conversations
-- deliberately allows direct authenticated UPDATEs (e.g. a staff member
-- toggling priority_level from the client, same pattern as the Integrations
-- module's is_active toggle) - but create_inbox_conversation_alerts() and
-- handle_inbox_message_operations() write to inbox_alerts, which has NO
-- authenticated INSERT policy (alerts are system-generated bookkeeping, not
-- something a client should ever insert directly). Without SECURITY
-- DEFINER, those trigger-internal inserts ran as the ORIGINAL caller and
-- were rejected by RLS, silently breaking any direct client update that
-- should have produced an alert. SECURITY DEFINER (matching every other
-- trigger function in this schema that writes to a system-only table, e.g.
-- content_platform_variants_validate_workspace()) fixes it: the trigger's
-- own writes are system-level bookkeeping, authorized once by the RLS
-- policy that let the ORIGINAL statement through, not re-gated per side
-- effect.

create or replace function public.create_inbox_conversation_alerts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'human_handoff' and (old.status is distinct from 'human_handoff' or old.ai_enabled is distinct from false) then
    insert into public.inbox_alerts (workspace_id, conversation_id, alert_type, severity, title, body, assigned_staff_id)
    values (new.workspace_id, new.id, 'human_handoff', 'warning', 'New human handoff', coalesce(new.display_name, new.wa_id) || ' requested human assistance.', new.assigned_staff_id)
    on conflict do nothing;
  end if;

  if new.priority_level in ('high', 'urgent') and old.priority_level is distinct from new.priority_level then
    insert into public.inbox_alerts (workspace_id, conversation_id, alert_type, severity, title, body, assigned_staff_id)
    values (new.workspace_id, new.id, 'high_priority', 'critical', 'High-priority conversation', coalesce(new.display_name, new.wa_id) || ' was marked ' || new.priority_level || ' priority.', new.assigned_staff_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

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

  if new.direction = 'outbound' and new.delivery_status = 'failed' then
    insert into public.inbox_alerts (workspace_id, conversation_id, alert_type, severity, title, body, message_id, assigned_staff_id)
    values (new.workspace_id, new.conversation_id, 'message_failed', 'critical', 'Message failed to send', 'A reply could not be delivered.', new.id, v_conversation.assigned_staff_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

-- sync_inbox_conversation_state() only mutates NEW in a BEFORE trigger (no
-- separate write statement of its own), so it was never subject to this
-- bug - re-created here anyway with SECURITY DEFINER for consistency with
-- its sibling trigger functions on this same table.
create or replace function public.sync_inbox_conversation_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'human_handoff' and (old.status is distinct from 'human_handoff' or old.ai_enabled is distinct from false) then
    new.inbox_status := case when new.assigned_staff_id is null then 'new' else 'assigned' end;
    new.resolved_at := null;
    new.resolved_by := null;
  end if;

  if new.status = 'human_handoff' and new.assigned_staff_id is distinct from old.assigned_staff_id and new.inbox_status <> 'waiting_client' then
    new.inbox_status := case when new.assigned_staff_id is null then 'unassigned' else 'assigned' end;
  end if;

  return new;
end;
$$;

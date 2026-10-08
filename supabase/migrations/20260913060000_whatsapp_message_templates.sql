-- Phase L-1. WhatsApp approved-template storage - the only way to send
-- outside the 24-hour customer-service messaging window (see
-- docs/architecture/whatsapp-messaging-window.md).
--
-- Workspace-scoped, discovered/synced from Meta (GET /{waba_id}/message_templates),
-- never authored/submitted to Meta from StabiFlow in V1 - creating and
-- getting a NEW template approved is a Meta review process in itself,
-- explicitly out of scope for this phase. This table only mirrors
-- templates a workspace ALREADY has approved (or pending/rejected, for
-- visibility) in their own WhatsApp Business Account.
--
-- provider_template_id is the source of truth for uniqueness (Meta's own
-- id, globally unique), same convention as workspace_whatsapp_numbers.phone_number_id
-- and every other *_key unique index in 20260824060400_workspace_integrations.sql -
-- a collision (the same template id discovered under a different
-- workspace) is skipped, never silently reassigned.

create table if not exists public.whatsapp_message_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  integration_id uuid not null references public.workspace_integrations(id) on delete cascade,
  waba_id text not null,

  provider_template_id text not null,
  name text not null,
  language text not null,
  category text,

  -- Meta's real statuses: APPROVED, PENDING, REJECTED, PAUSED, DISABLED -
  -- kept as free text (not an enum/check) since Meta has added statuses
  -- before and StabiFlow should never fail closed on an unrecognized one
  -- at the DB layer - the send path (Phase L-1 code) is what actually
  -- gates on "== APPROVED", not a constraint here.
  provider_status text not null,

  -- Meta's own component structure (HEADER/BODY/FOOTER/BUTTONS, each with
  -- its variable placeholders and example values) - stored verbatim so
  -- parameter validation at send time never has to re-derive it from a
  -- separate, hand-maintained schema.
  components jsonb not null default '[]'::jsonb,

  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists whatsapp_message_templates_provider_id_key
  on public.whatsapp_message_templates (provider_template_id);
create index if not exists whatsapp_message_templates_workspace_idx
  on public.whatsapp_message_templates (workspace_id, provider_status);
create index if not exists whatsapp_message_templates_waba_idx
  on public.whatsapp_message_templates (waba_id);

drop trigger if exists set_whatsapp_message_templates_updated_at on public.whatsapp_message_templates;
create trigger set_whatsapp_message_templates_updated_at before update on public.whatsapp_message_templates
  for each row execute function public.set_updated_at();

-- Same workspace-consistency defense as inbox_conversations/every other
-- provider-resource table: integration_id must actually belong to
-- workspace_id, checked at write time, not just assumed from RLS.
create or replace function public.whatsapp_message_templates_validate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.workspace_integrations
    where id = new.integration_id and workspace_id = new.workspace_id and provider = 'whatsapp'
  ) then
    raise exception 'whatsapp_message_templates.workspace_id must match its integration_id''s workspace (and be a whatsapp integration)' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists whatsapp_message_templates_validate_workspace_trg on public.whatsapp_message_templates;
create trigger whatsapp_message_templates_validate_workspace_trg
  before insert or update on public.whatsapp_message_templates
  for each row execute function public.whatsapp_message_templates_validate_workspace();

alter table public.whatsapp_message_templates enable row level security;

-- Broad view (same bar as inbox.view - every role that can see the Inbox
-- can see what templates are available for the closed-window selector),
-- write restricted to inbox.manage (same bar as sending a reply at all).
-- No client insert/update/delete beyond what the sync path (service role,
-- via integrations-discover-resources - already integration.manage-gated
-- server-side) performs; inbox.manage members can only ever READ rows
-- here, never write them directly - sync is the only writer, matching the
-- existing discovery-resource convention (upsertDiscoveredResource is
-- always service-role).
drop policy if exists "whatsapp_message_templates_select_member" on public.whatsapp_message_templates;
create policy "whatsapp_message_templates_select_member"
on public.whatsapp_message_templates for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'inbox.view'));

-- No insert/update/delete policy for authenticated - service role only
-- (the discovery/sync path), mirroring workspace_facebook_pages et al.

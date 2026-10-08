-- Phase I (Flow AI) foundation - V1 is strictly READ + RECOMMEND. No
-- mutation tool exists anywhere in this migration; every new RPC below is
-- `select`-only and re-checks the SAME permission the source module
-- already requires (never a blanket "AI is authorized" bypass).
--
-- Conversation storage mirrors inbox_conversations/inbox_messages's shape
-- (Phase D) - a header row + append-only message rows, both workspace_id-
-- scoped. Conversations are additionally scoped to their creator
-- (created_by = auth.uid()) - Flow AI is a personal assistant thread, not
-- a shared workspace inbox, so this is a deliberately tighter RLS policy
-- than most workspace-scoped tables here.
--
-- ai_usage_events matches the shape already speced in
-- docs/architecture/ai-architecture.md - metadata/token counts only,
-- never raw prompt/response content, never the API key.

-- 1. Conversations -----------------------------------------------------------

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'New conversation' check (length(title) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_conversations_workspace_creator_idx
  on public.ai_conversations (workspace_id, created_by, updated_at desc);

drop trigger if exists set_ai_conversations_updated_at on public.ai_conversations;
create trigger set_ai_conversations_updated_at before update on public.ai_conversations
  for each row execute function public.set_updated_at();

alter table public.ai_conversations enable row level security;

drop policy if exists "ai_conversations_select_own" on public.ai_conversations;
create policy "ai_conversations_select_own"
on public.ai_conversations for select
to authenticated
using (public.is_workspace_member(workspace_id) and created_by = auth.uid());

drop policy if exists "ai_conversations_insert_own" on public.ai_conversations;
create policy "ai_conversations_insert_own"
on public.ai_conversations for insert
to authenticated
with check (public.is_workspace_member(workspace_id) and public.has_workspace_permission(workspace_id, 'flow_ai.use') and created_by = auth.uid());

drop policy if exists "ai_conversations_update_own" on public.ai_conversations;
create policy "ai_conversations_update_own"
on public.ai_conversations for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

-- No delete policy in V1 - conversations are kept, same "never hard-delete
-- audit-adjacent history" posture as workspace_activity_log.

-- 2. Messages ------------------------------------------------------------------

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text,
  tool_name text,
  tool_call_id text,
  tool_args jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_messages_conversation_idx
  on public.ai_messages (conversation_id, created_at asc);

alter table public.ai_messages enable row level security;

-- Access to a message requires access to its parent conversation - the
-- same "prove ownership of the parent" shape inbox_messages uses relative
-- to inbox_conversations, just via ai_conversations's tighter (per-creator)
-- policy instead of a whole-workspace one.
drop policy if exists "ai_messages_select_via_conversation" on public.ai_messages;
create policy "ai_messages_select_via_conversation"
on public.ai_messages for select
to authenticated
using (exists (
  select 1 from public.ai_conversations c
  where c.id = conversation_id and c.workspace_id = ai_messages.workspace_id and c.created_by = auth.uid()
));

-- No client insert policy: every message (both the human's turn and the
-- assistant/tool turns) is written by the flow-ai-chat edge function via
-- the service-role client, after that function has already verified the
-- caller owns the conversation - same "no direct client write for a
-- cross-cutting rule" posture as leads-actions/inbox-actions.

-- 3. Usage/cost telemetry -------------------------------------------------------

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid references public.ai_conversations(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  feature text not null default 'flow_ai_chat',
  provider text not null default 'openai',
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  total_tokens integer generated always as (input_tokens + output_tokens) stored,
  estimated_cost numeric(10, 6),
  latency_ms integer,
  status text not null check (status in ('success', 'error', 'aborted', 'blocked_quota')),
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_events_workspace_created_idx
  on public.ai_usage_events (workspace_id, created_at desc);

alter table public.ai_usage_events enable row level security;

-- Usage/cost is billing-adjacent, not conversation content - gated on
-- manage_billing (owner/admin only), same cutoff manage_billing already
-- uses elsewhere, rather than flow_ai.use (which every role gets).
drop policy if exists "ai_usage_events_select_billing" on public.ai_usage_events;
create policy "ai_usage_events_select_billing"
on public.ai_usage_events for select
to authenticated
using (public.has_workspace_permission(workspace_id, 'manage_billing'));

-- No client insert/update/delete policy anywhere - only the flow-ai-chat
-- edge function's service-role client ever writes a usage row.

-- 4. Permission: flow_ai.use ------------------------------------------------
-- Gates chat ACCESS only (can a user open Flow AI and send a message at
-- all) - it does NOT grant visibility into any workspace data. Every tool
-- below independently re-checks the permission the source module already
-- requires (view_analytics, revenue.view, campaign.view, lead.view,
-- opportunity.view, inbox.view, content.view, integration.view). Granted
-- broadly (every role including viewer), matching content.view/
-- campaign.view's breadth - what a user can ASK ABOUT is still narrowed
-- per-tool by their existing permissions.

insert into public.workspace_role_permissions (role, permission) values
  ('owner', 'flow_ai.use'),
  ('admin', 'flow_ai.use'),
  ('manager', 'flow_ai.use'),
  ('marketing', 'flow_ai.use'),
  ('sales', 'flow_ai.use'),
  ('support', 'flow_ai.use'),
  ('viewer', 'flow_ai.use')
on conflict (role, permission) do nothing;

-- 5. Curated read-only tool RPCs ------------------------------------------------
-- Each mirrors the exact shape of Phase H's get_* read models: `stable`,
-- `security definer`, self-gates by returning empty on a missing
-- permission (never an error that would leak "this exists but you can't
-- see it" vs "this doesn't exist"), and accepts only its own business
-- parameters - never a workspace_id override from anywhere but the
-- server-resolved value the edge function passes in. No new business
-- logic: every column selected already exists and already means what the
-- owning module says it means (no re-derived "qualified" logic, no
-- re-derived campaign status).

create or replace function public.ai_list_campaigns(p_workspace_id uuid, p_status text default null, p_limit integer default 20)
returns table (id uuid, name text, status text, objective text, currency text, daily_budget_minor_units bigint, lifetime_budget_minor_units bigint, start_at timestamptz, end_at timestamptz, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_workspace_permission(p_workspace_id, 'campaign.view') then
    return;
  end if;
  return query
    select c.id, c.name, c.status::text, c.objective::text, c.currency, c.daily_budget_minor_units, c.lifetime_budget_minor_units, c.start_at, c.end_at, c.created_at
    from public.ad_campaigns c
    where c.workspace_id = p_workspace_id
      and (p_status is null or c.status::text = p_status)
    order by c.created_at desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

comment on function public.ai_list_campaigns(uuid, text, integer) is
  'Flow AI read tool - lists Meta campaigns for a workspace. Gated on campaign.view. No spend/performance figures here - use get_campaign_performance for that.';

create or replace function public.ai_list_leads(p_workspace_id uuid, p_status text default null, p_qualification_status text default null, p_date_from timestamptz default null, p_date_to timestamptz default null, p_limit integer default 20)
returns table (id uuid, human_reference text, contact_name text, company_name text, source text, status text, qualification_status text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_workspace_permission(p_workspace_id, 'lead.view') then
    return;
  end if;
  return query
    select l.id, l.human_reference, l.contact_name, l.company_name, l.source, l.status, l.qualification_status, l.created_at
    from public.leads l
    where l.workspace_id = p_workspace_id
      and (p_status is null or l.status = p_status)
      and (p_qualification_status is null or l.qualification_status = p_qualification_status)
      and (p_date_from is null or l.created_at >= p_date_from)
      and (p_date_to is null or l.created_at < p_date_to)
    order by l.created_at desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

comment on function public.ai_list_leads(uuid, text, text, timestamptz, timestamptz, integer) is
  'Flow AI read tool - lists leads for a workspace with optional status/qualification/date filters. Gated on lead.view. Never includes phone/email - contact_name/company_name only, to keep tool context minimal.';

create or replace function public.ai_list_opportunities(p_workspace_id uuid, p_status text default null, p_date_from timestamptz default null, p_date_to timestamptz default null, p_limit integer default 20)
returns table (id uuid, title text, status text, estimated_value numeric, actual_value numeric, probability integer, created_at timestamptz, won_at timestamptz, lost_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_workspace_permission(p_workspace_id, 'opportunity.view') then
    return;
  end if;
  return query
    select o.id, o.title, o.status, o.estimated_value, o.actual_value, o.probability, o.created_at, o.won_at, o.lost_at
    from public.opportunities o
    where o.workspace_id = p_workspace_id
      and (p_status is null or o.status = p_status)
      and (p_date_from is null or o.created_at >= p_date_from)
      and (p_date_to is null or o.created_at < p_date_to)
    order by o.created_at desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

comment on function public.ai_list_opportunities(uuid, text, timestamptz, timestamptz, integer) is
  'Flow AI read tool - lists opportunities for a workspace with optional status/date filters. Gated on opportunity.view.';

create or replace function public.ai_list_customers(p_workspace_id uuid, p_date_from timestamptz default null, p_date_to timestamptz default null, p_limit integer default 20)
returns table (id uuid, name text, company_name text, customer_since timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_workspace_permission(p_workspace_id, 'opportunity.view') then
    return;
  end if;
  return query
    select c.id, c.name, c.company_name, c.customer_since
    from public.customers c
    where c.workspace_id = p_workspace_id
      and (p_date_from is null or c.customer_since >= p_date_from)
      and (p_date_to is null or c.customer_since < p_date_to)
    order by c.customer_since desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

comment on function public.ai_list_customers(uuid, timestamptz, timestamptz, integer) is
  'Flow AI read tool - lists customers for a workspace. Gated on opportunity.view (customers are opportunity-adjacent; no dedicated customer.view permission exists yet). Never includes phone/email.';

create or replace function public.ai_list_integrations(p_workspace_id uuid)
returns table (provider text, status text, connected_at timestamptz, last_health_check_at timestamptz, last_health_check_status text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_workspace_permission(p_workspace_id, 'integration.view') then
    return;
  end if;
  return query
    select i.provider::text, i.status::text, i.connected_at, i.last_health_check_at, i.last_health_check_status
    from public.workspace_integrations i
    where i.workspace_id = p_workspace_id
    order by i.provider;
end;
$$;

comment on function public.ai_list_integrations(uuid) is
  'Flow AI read tool - connection status per provider for a workspace. Gated on integration.view. Never touches vault_secret_id or any decrypted secret - status/timestamps only.';

create or replace function public.ai_list_content(p_workspace_id uuid, p_status text default null, p_limit integer default 20)
returns table (id uuid, target_platform text, status text, scheduled_at timestamptz, published_at timestamptz, caption_preview text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_workspace_permission(p_workspace_id, 'content.view') then
    return;
  end if;
  return query
    select p.id, p.target_platform::text, p.status::text, p.scheduled_at, p.published_at, left(p.caption, 140)
    from public.content_scheduled_posts p
    where p.workspace_id = p_workspace_id
      and (p_status is null or p.status::text = p_status)
    order by p.scheduled_at desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

comment on function public.ai_list_content(uuid, text, integer) is
  'Flow AI read tool - lists scheduled/published content posts for a workspace. Gated on content.view. Caption is truncated to 140 chars to keep tool-result context small, not for privacy (content.view already permits reading the full caption elsewhere).';

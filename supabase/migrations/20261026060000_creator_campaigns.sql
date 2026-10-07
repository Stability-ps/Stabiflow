-- Creator Campaigns: paid creator/UGC performance tracking.
-- Manual metrics work immediately; provider sync can update the same post rows later.

create table public.creator_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  creator_name text not null,
  platform text not null check (platform in ('instagram','youtube','tiktok','facebook','other')),
  creator_handle text,
  fee_minor_units bigint not null default 0 check (fee_minor_units >= 0),
  currency text not null default 'USD' check (char_length(currency)=3),
  contracted_videos integer not null default 1 check (contracted_videos > 0),
  start_date date,
  end_date date,
  status text not null default 'active' check (status in ('draft','active','completed','paused')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.creator_campaign_posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.creator_campaigns(id) on delete cascade,
  platform text not null,
  post_url text,
  external_post_id text,
  title text,
  published_at timestamptz,
  views bigint not null default 0 check (views >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  installs bigint not null default 0 check (installs >= 0),
  leads bigint not null default 0 check (leads >= 0),
  paid_customers bigint not null default 0 check (paid_customers >= 0),
  revenue_minor_units bigint not null default 0 check (revenue_minor_units >= 0),
  last_synced_at timestamptz,
  raw_provider_metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index creator_campaigns_workspace_idx on public.creator_campaigns(workspace_id, created_at desc);
create index creator_campaign_posts_campaign_idx on public.creator_campaign_posts(campaign_id, published_at desc);

create trigger set_creator_campaigns_updated_at before update on public.creator_campaigns
for each row execute function public.set_updated_at();
create trigger set_creator_campaign_posts_updated_at before update on public.creator_campaign_posts
for each row execute function public.set_updated_at();

alter table public.creator_campaigns enable row level security;
alter table public.creator_campaign_posts enable row level security;

create policy "creator campaigns view" on public.creator_campaigns for select to authenticated
using (public.has_workspace_permission(workspace_id, 'view_analytics'));
create policy "creator campaigns create" on public.creator_campaigns for insert to authenticated
with check (public.has_workspace_permission(workspace_id, 'campaign.create') and created_by = auth.uid());
create policy "creator campaigns edit" on public.creator_campaigns for update to authenticated
using (public.has_workspace_permission(workspace_id, 'campaign.edit'))
with check (public.has_workspace_permission(workspace_id, 'campaign.edit'));
create policy "creator campaigns delete" on public.creator_campaigns for delete to authenticated
using (public.has_workspace_permission(workspace_id, 'campaign.edit'));

create policy "creator posts view" on public.creator_campaign_posts for select to authenticated
using (public.has_workspace_permission(workspace_id, 'view_analytics'));
create policy "creator posts create" on public.creator_campaign_posts for insert to authenticated
with check (
  public.has_workspace_permission(workspace_id, 'campaign.create')
  and exists (select 1 from public.creator_campaigns c where c.id=campaign_id and c.workspace_id=workspace_id)
);
create policy "creator posts edit" on public.creator_campaign_posts for update to authenticated
using (public.has_workspace_permission(workspace_id, 'campaign.edit'))
with check (
  public.has_workspace_permission(workspace_id, 'campaign.edit')
  and exists (select 1 from public.creator_campaigns c where c.id=campaign_id and c.workspace_id=workspace_id)
);
create policy "creator posts delete" on public.creator_campaign_posts for delete to authenticated
using (public.has_workspace_permission(workspace_id, 'campaign.edit'));

comment on table public.creator_campaigns is 'Paid creator/UGC agreements: fee, contracted deliverables and campaign identity.';
comment on table public.creator_campaign_posts is 'Per-post creator performance. Manual metrics now; provider APIs may safely upsert external metrics later.';

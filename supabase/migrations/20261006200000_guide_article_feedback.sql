-- StabiFlow Guide: "Was this helpful?" feedback, one answer per user per
-- article (changing your mind updates the row). Additive only.
--
-- RLS: a signed-in user can read and write only their own rows, and only for
-- a workspace they belong to. Platform staff read it through the service
-- role; nothing here is exposed to anon.

create table if not exists public.guide_article_feedback (
  user_id uuid not null references auth.users(id) on delete cascade,
  article_slug text not null check (article_slug ~ '^[a-z0-9-]{1,60}$'),
  workspace_id uuid references public.workspaces(id) on delete set null,
  helpful boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, article_slug)
);

alter table public.guide_article_feedback enable row level security;

revoke all on public.guide_article_feedback from anon;
grant select, insert, update on public.guide_article_feedback to authenticated;

drop policy if exists guide_article_feedback_select_own on public.guide_article_feedback;
create policy guide_article_feedback_select_own on public.guide_article_feedback
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists guide_article_feedback_insert_own on public.guide_article_feedback;
create policy guide_article_feedback_insert_own on public.guide_article_feedback
for insert to authenticated with check (
  (select auth.uid()) = user_id
  and (workspace_id is null or public.is_workspace_member(workspace_id))
);

drop policy if exists guide_article_feedback_update_own on public.guide_article_feedback;
create policy guide_article_feedback_update_own on public.guide_article_feedback
for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and (workspace_id is null or public.is_workspace_member(workspace_id))
);

drop trigger if exists set_guide_article_feedback_updated_at on public.guide_article_feedback;
create trigger set_guide_article_feedback_updated_at
before update on public.guide_article_feedback
for each row execute function public.set_updated_at();

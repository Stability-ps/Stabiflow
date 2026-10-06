create table if not exists public.whatsapp_template_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  template_id uuid not null references public.whatsapp_template_library(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, template_id)
);
alter table public.whatsapp_template_favorites enable row level security;
grant select, insert, delete on public.whatsapp_template_favorites to authenticated;
revoke all on public.whatsapp_template_favorites from anon;

drop policy if exists whatsapp_template_favorites_select_own on public.whatsapp_template_favorites;
create policy whatsapp_template_favorites_select_own on public.whatsapp_template_favorites
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists whatsapp_template_favorites_insert_own on public.whatsapp_template_favorites;
create policy whatsapp_template_favorites_insert_own on public.whatsapp_template_favorites
for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists whatsapp_template_favorites_delete_own on public.whatsapp_template_favorites;
create policy whatsapp_template_favorites_delete_own on public.whatsapp_template_favorites
for delete to authenticated using ((select auth.uid()) = user_id);

create index if not exists whatsapp_template_favorites_template_idx
on public.whatsapp_template_favorites(template_id);

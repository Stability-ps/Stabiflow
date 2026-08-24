-- Private media storage for the Content module. Path convention:
-- {workspace_id}/{timestamp}-{filename} for originals,
-- {workspace_id}/variants/{assetId}-{platform}-{timestamp}.{ext} for
-- generated platform variants - the workspace id is always the first path
-- segment, which is what every policy below actually checks membership
-- against (not the caller's claimed workspace - the literal object path
-- being read/written), so a caller cannot read, upload into, or overwrite
-- another workspace's path by spoofing a request parameter.

insert into storage.buckets (id, name, public)
values ('content-media', 'content-media', false)
on conflict (id) do update set public = excluded.public;

-- split_part(...)::uuid on a malformed/foreign path throws
-- invalid_text_representation inside a plain SQL function, which would
-- surface as an ugly policy-evaluation error rather than "access denied".
-- Wrapping in plpgsql to catch that and return null (which then simply
-- fails every workspace check below) keeps a malformed path a clean deny.
create or replace function public.content_storage_path_workspace_id(p_name text)
returns uuid
language plpgsql
immutable
as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

drop policy if exists "content_media_select_member" on storage.objects;
create policy "content_media_select_member"
on storage.objects for select
to authenticated
using (
  bucket_id = 'content-media'
  and public.has_workspace_permission(public.content_storage_path_workspace_id(name), 'media.view')
);

drop policy if exists "content_media_insert_uploader" on storage.objects;
create policy "content_media_insert_uploader"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'content-media'
  and public.has_workspace_permission(public.content_storage_path_workspace_id(name), 'media.upload')
);

drop policy if exists "content_media_delete_uploader" on storage.objects;
create policy "content_media_delete_uploader"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'content-media'
  and public.has_workspace_permission(public.content_storage_path_workspace_id(name), 'media.delete')
);

-- Deliberately no UPDATE policy: every upload in this bucket uses a unique,
-- timestamped path (never upsert:true), so there is no legitimate
-- "overwrite an existing object" operation to authorize. With no policy,
-- RLS denies it by default - an object can only ever be replaced by
-- uploading a new path and deleting the old one (both already covered).

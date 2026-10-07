-- Connected-account rows are created and changed by the server only.
--
-- workspace_integrations and its resource tables (WhatsApp numbers, Facebook
-- pages, Instagram accounts, Meta ad accounts) had "ALL" policies for
-- integration.manage, so a workspace admin could INSERT a WhatsApp number
-- row with a phone_number_id that is not yet connected anywhere. Inbound
-- messages for that number would then be routed to their workspace, and the
-- real owner's later connection would fail on the unique key.
--
-- Rows are created by integrations-oauth-callback / -discover-resources and
-- kept up to date by the health checks, intake-actions and disconnect - all
-- with the service role. The app itself only flips is_active on a resource
-- (lib/integrations.ts setResourceActive). So for direct client writes:
-- - INSERT is refused on all five tables;
-- - UPDATE may only change is_active on the four resource tables, and is
--   refused on workspace_integrations;
-- - DELETE is unchanged.
-- The service role and SECURITY DEFINER functions are unaffected. Additive:
-- no policy changes, rollback is dropping the triggers.

create or replace function public.guard_integration_resource_client_writes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'Accounts are connected from the Integrations page.' using errcode = '42501';
  end if;

  if tg_table_name = 'workspace_integrations'
     or (to_jsonb(new) - 'is_active' - 'updated_at') is distinct from (to_jsonb(old) - 'is_active' - 'updated_at') then
    raise exception 'Only the on/off setting of a connected account can be changed here.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_integration_resource_client_writes() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['workspace_integrations', 'workspace_whatsapp_numbers', 'workspace_facebook_pages', 'workspace_instagram_accounts', 'workspace_meta_ad_accounts']
  loop
    execute format('drop trigger if exists guard_integration_resource_client_writes_trg on public.%I', t);
    execute format('create trigger guard_integration_resource_client_writes_trg before insert or update on public.%I for each row execute function public.guard_integration_resource_client_writes()', t);
  end loop;
end;
$$;

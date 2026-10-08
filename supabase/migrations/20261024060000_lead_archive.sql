-- Lead archiving: remove a lead from active CRM views without deleting it.
--
-- There is deliberately no DELETE policy on leads. Archiving keeps the lead,
-- its conversations, notes, activity, opportunities, follow-up history and
-- attribution intact; it only hides the lead from active views and lists.
-- Archive/restore go through leads-actions (archive_lead / restore_lead),
-- which require the existing lead.delete permission (owner/admin/manager)
-- and write an activity entry. Additive only.

alter table public.leads
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null;

create index if not exists leads_workspace_not_archived_idx
  on public.leads (workspace_id, updated_at desc)
  where archived_at is null;

-- Only the server (leads-actions, service role) may change archive state.
-- The existing leads_update policy lets lead.edit roles update leads, so
-- without this guard a lead.edit user could archive through the REST API
-- and bypass the lead.delete check.
create or replace function public.leads_guard_archive_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.archived_at is distinct from old.archived_at or new.archived_by is distinct from old.archived_by)
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Archive a lead with the Archive lead action' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists leads_guard_archive_columns_trg on public.leads;
create trigger leads_guard_archive_columns_trg
before update on public.leads
for each row execute function public.leads_guard_archive_columns();

-- New leads can never be created already archived by a client.
create or replace function public.leads_guard_archive_on_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.archived_at is not null or new.archived_by is not null) and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'New leads cannot be archived' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists leads_guard_archive_on_insert_trg on public.leads;
create trigger leads_guard_archive_on_insert_trg
before insert on public.leads
for each row execute function public.leads_guard_archive_on_insert();

-- Flow AI lists working leads only; archived leads are out of the way by
-- design. Same signature, so existing grants are unchanged.
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
      and l.archived_at is null
      and (p_status is null or l.status = p_status)
      and (p_qualification_status is null or l.qualification_status = p_qualification_status)
      and (p_date_from is null or l.created_at >= p_date_from)
      and (p_date_to is null or l.created_at < p_date_to)
    order by l.created_at desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;

revoke execute on function public.leads_guard_archive_columns() from public, anon, authenticated;
revoke execute on function public.leads_guard_archive_on_insert() from public, anon, authenticated;

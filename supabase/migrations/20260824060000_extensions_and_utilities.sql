-- StabiFlow foundation: extensions and shared trigger utilities.
-- Nothing in this file is tenant-scoped - it's infrastructure every later
-- migration depends on.

create extension if not exists pgcrypto;
create extension if not exists pg_net;

-- Shared "touch updated_at" trigger, reused by every table below that has
-- an updated_at column instead of redefining the same function per table.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

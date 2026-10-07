-- Give back allowance that was consumed for work that then failed (e.g. an
-- AI request that errored after its credit was taken). Without this, a
-- failed AI caption silently used up a paid AI credit.
-- Server-only: callable by the service role from edge functions, never by
-- customers. Never takes usage below zero; only the current period.
create or replace function public.refund_entitlement(p_workspace_id uuid, p_key text, p_amount bigint default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount is null or p_amount <= 0 then
    return;
  end if;
  update public.entitlement_usage
  set used = greatest(used - p_amount, 0), updated_at = now()
  where workspace_id = p_workspace_id
    and entitlement_key = p_key
    and period_start = date_trunc('month', now())::date;
end;
$$;

revoke execute on function public.refund_entitlement(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.refund_entitlement(uuid, text, bigint) to service_role;

-- LOCAL ONLY (runs after migrations on `supabase db reset`, never in
-- production). Point this database's cron jobs at the local API gateway
-- instead of production - see 20261021060000_cron_project_url.sql.
do $$
begin
  if exists (select 1 from vault.secrets where name = 'project_url') then
    perform vault.update_secret((select id from vault.secrets where name = 'project_url'), 'http://host.docker.internal:54321');
  else
    perform vault.create_secret('http://host.docker.internal:54321', 'project_url', 'Local API gateway for cron jobs.');
  end if;
end
$$;

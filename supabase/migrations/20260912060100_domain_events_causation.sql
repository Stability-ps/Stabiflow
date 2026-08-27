-- Loop-prevention requires knowing, for any NEW domain event, whether it
-- was itself produced by an automation's action (as opposed to a genuine
-- independent user/system action) - without this, "automation A moves a
-- lead's stage -> emits lead.stage_changed -> re-triggers automation A"
-- is undetectable. These columns are populated by emitDomainEvent()
-- whenever the caller (an action dispatcher acting on an automation's
-- behalf) supplies causation context; every other emitter (a normal user
-- action) leaves them null, which is the correct "not automation-caused"
-- state, not a missing-data problem.

alter table public.domain_events
  add column if not exists caused_by_run_id uuid references public.automation_runs(id) on delete set null,
  add column if not exists caused_by_automation_id uuid references public.automations(id) on delete set null,
  add column if not exists correlation_id uuid,
  add column if not exists causation_depth integer not null default 0 check (causation_depth >= 0);

create index if not exists domain_events_caused_by_automation_idx on public.domain_events (caused_by_automation_id) where caused_by_automation_id is not null;

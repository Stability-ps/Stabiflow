alter table public.leads
  add column if not exists next_follow_up_at timestamptz,
  add column if not exists follow_up_note text,
  add column if not exists follow_up_completed_at timestamptz;

create index if not exists leads_workspace_follow_up_due_idx
  on public.leads (workspace_id, next_follow_up_at)
  where status = 'active' and next_follow_up_at is not null;

comment on column public.leads.next_follow_up_at is
  'Next planned follow-up time for this lead. Null means no follow-up is scheduled.';
comment on column public.leads.follow_up_note is
  'Short user-entered context for the next lead follow-up.';
comment on column public.leads.follow_up_completed_at is
  'Timestamp of the most recently completed follow-up.';

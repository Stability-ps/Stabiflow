-- Retention V1 - approved policy (see project memory: owner-approved
-- 2026-10-05):
--   WhatsApp messages + media + transcripts       -> 730 days
--   Conversation-side structured intake            -> follows conversation
--   leads.intake                                   -> kept with CRM, untouched
--   Resolved inbox alerts                          -> 90 days
--   Terminal automation runs                       -> 180 days
--   ai_usage_events                                -> 730 days
-- Explicitly EXCLUDED from this (and any future generic) sweep: leads,
-- customers, opportunities, crm_notes, pipelines, lead_attachments
-- metadata, attribution_events, revenue_events, domain_events,
-- workspace_activity_log, workspace_whatsapp_webhook_events,
-- legal_acceptances, legal_document_versions, platform_deletion_log,
-- Creative Studio assets, content/campaign media, all configuration
-- tables. None of those are touched by this migration.
--
-- Every delete below is ONE atomic SQL statement (a DELETE whose target
-- rows are chosen by a FOR UPDATE SKIP LOCKED subquery in the SAME
-- statement) - never a SELECT snapshot followed by a separate DELETE, so
-- there is no window for a row to change state in between. Two overlapping
-- retention-tick invocations naturally partition disjoint row sets via
-- SKIP LOCKED rather than needing a global lock.
--
-- The one category that needs an external side effect (deleting the
-- Storage object) BEFORE the DB row can safely go - media-bearing
-- messages - uses an explicit two-phase claim/confirm, mirroring the
-- existing Phase 9 outbound-retry claim pattern exactly, but on a
-- dedicated column (retention_claimed_at) so it never collides with
-- retry_claimed_at's unrelated meaning (an outbound send in flight).

-- 1. Claim column for the media two-phase delete -----------------------------

alter table public.inbox_messages
  add column if not exists retention_claimed_at timestamptz;

comment on column public.inbox_messages.retention_claimed_at is
  'Retention V1: set by retention_claim_media_messages_batch() while the Storage object at media_storage_path is being deleted, so a concurrent tick never double-claims the same row. Cleared by retention_release_media_claim() on a failed Storage delete (fast retry) or implicitly by row deletion on success. A claim older than 1 hour is treated as stale/abandoned and re-claimable.';

-- 2. Text/no-media messages: fully atomic, single-statement delete ----------
-- Protects (per the approved safety rules): retry-eligible
-- (next_retry_at is not null), unresolved dead-lettered
-- (dead_lettered_at is not null), anything actively claimed by the OTHER
-- (outbound-send) claim column, and anything a CRM lead_attachments row
-- still points at.

create or replace function public.retention_delete_eligible_text_messages(
  p_cutoff timestamptz,
  p_batch_size integer default 500
)
returns integer
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select id from public.inbox_messages im
    where im.created_at < p_cutoff
      and im.media_storage_path is null
      and im.dead_lettered_at is null
      and im.next_retry_at is null
      and im.retry_claimed_at is null
      and not exists (select 1 from public.lead_attachments la where la.message_id = im.id)
    order by im.created_at
    limit greatest(p_batch_size, 0)
    for update skip locked
  ),
  deleted as (
    delete from public.inbox_messages where id in (select id from candidates)
    returning 1
  )
  select count(*)::integer from deleted;
$$;

-- 3. Media-bearing messages: claim -> (caller deletes Storage object) -> confirm

create or replace function public.retention_claim_media_messages_batch(
  p_cutoff timestamptz,
  p_batch_size integer default 200
)
returns table (id uuid, storage_bucket text, storage_path text)
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select im.id from public.inbox_messages im
    where im.created_at < p_cutoff
      and im.media_storage_path is not null
      and im.dead_lettered_at is null
      and im.next_retry_at is null
      and im.retry_claimed_at is null
      and (im.retention_claimed_at is null or im.retention_claimed_at < now() - interval '1 hour')
      and not exists (select 1 from public.lead_attachments la where la.message_id = im.id)
    order by im.created_at
    limit greatest(p_batch_size, 0)
    for update skip locked
  )
  update public.inbox_messages im
  set retention_claimed_at = now()
  from candidates
  where im.id = candidates.id
  returning im.id, 'inbox-media'::text, im.media_storage_path;
$$;

create or replace function public.retention_confirm_media_message_deleted(p_message_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.inbox_messages im
    where im.id = p_message_id
      and im.retention_claimed_at is not null
      and im.dead_lettered_at is null
      and im.next_retry_at is null
      and im.retry_claimed_at is null
      and not exists (select 1 from public.lead_attachments la where la.message_id = im.id)
    returning 1
  )
  select exists(select 1 from deleted);
$$;

-- Fast-path retry: called when the Storage delete itself failed, so the
-- NEXT tick can re-claim this row well before the 1-hour stale-claim
-- fallback above would otherwise allow it.
create or replace function public.retention_release_media_claim(p_message_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.inbox_messages
  set retention_claimed_at = null
  where id = p_message_id and retention_claimed_at is not null;
$$;

-- 4. Resolved inbox alerts (90 days). Active/unresolved alerts are never
--    touched - the guard is literally the is_resolved column the product
--    already uses to distinguish "Needs Attention" from history.

create or replace function public.retention_delete_resolved_alerts(
  p_cutoff timestamptz,
  p_batch_size integer default 500
)
returns integer
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select id from public.inbox_alerts
    where is_resolved = true and resolved_at is not null and resolved_at < p_cutoff
    order by resolved_at
    limit greatest(p_batch_size, 0)
    for update skip locked
  ),
  deleted as (
    delete from public.inbox_alerts where id in (select id from candidates)
    returning 1
  )
  select count(*)::integer from deleted;
$$;

-- 5. Terminal automation runs (180 days). pending/in_progress are never
--    eligible (they are not in the terminal-status list at all); a
--    terminal-status row with no finished_at (should not happen) is
--    conservatively never purged either. Deleted directly - never via a
--    domain_events cascade, so this is independent of the (intentionally
--    unretained) domain_events table.

create or replace function public.retention_delete_terminal_automation_runs(
  p_cutoff timestamptz,
  p_batch_size integer default 500
)
returns integer
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select id from public.automation_runs
    where status in ('succeeded', 'partial', 'failed', 'skipped_conditions_not_met', 'blocked_permission')
      and finished_at is not null
      and finished_at < p_cutoff
    order by finished_at
    limit greatest(p_batch_size, 0)
    for update skip locked
  ),
  deleted as (
    delete from public.automation_runs where id in (select id from candidates)
    returning 1
  )
  select count(*)::integer from deleted;
$$;

-- 6. ai_usage_events (730 days). Pure metering data (tokens/cost/latency/
--    model/status) - no message content. The monthly-cap feature only
--    ever reads the current UTC calendar month, so nothing operational
--    depends on rows this old.

create or replace function public.retention_delete_old_ai_usage_events(
  p_cutoff timestamptz,
  p_batch_size integer default 1000
)
returns integer
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select id from public.ai_usage_events
    where created_at < p_cutoff
    order by created_at
    limit greatest(p_batch_size, 0)
    for update skip locked
  ),
  deleted as (
    delete from public.ai_usage_events where id in (select id from candidates)
    returning 1
  )
  select count(*)::integer from deleted;
$$;

-- 7. Empty, old, dependency-free conversations. Only once EVERY message is
--    already gone (this tick's own message cleanup counts, since the
--    caller runs this after), and nothing else still points at it: no
--    lead's created_from_conversation_id, no lead_attachments row, no
--    unresolved alert.

create or replace function public.retention_delete_empty_old_conversations(
  p_cutoff timestamptz,
  p_batch_size integer default 200
)
returns integer
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select c.id from public.inbox_conversations c
    where c.updated_at < p_cutoff
      and not exists (select 1 from public.inbox_messages im where im.conversation_id = c.id)
      and not exists (select 1 from public.leads l where l.created_from_conversation_id = c.id)
      and not exists (select 1 from public.lead_attachments la where la.conversation_id = c.id)
      and not exists (select 1 from public.inbox_alerts al where al.conversation_id = c.id and al.is_resolved = false)
    order by c.updated_at
    limit greatest(p_batch_size, 0)
    for update skip locked
  ),
  deleted as (
    delete from public.inbox_conversations where id in (select id from candidates)
    returning 1
  )
  select count(*)::integer from deleted;
$$;

-- 8. Read-only production dry-run preview - the exact counts the release
--    runbook requires before the cron is ever enabled against production.
--    No message/customer content - aggregate counts only.

create or replace function public.retention_preview_counts()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'messages_older_than_730d', (select count(*) from public.inbox_messages where created_at < now() - interval '730 days'),
    'blocked_by_retry', (select count(*) from public.inbox_messages where created_at < now() - interval '730 days' and next_retry_at is not null),
    'blocked_by_claim', (select count(*) from public.inbox_messages where created_at < now() - interval '730 days' and retry_claimed_at is not null),
    'blocked_by_dead_letter', (select count(*) from public.inbox_messages where created_at < now() - interval '730 days' and dead_lettered_at is not null),
    'blocked_by_lead_attachment', (select count(*) from public.inbox_messages im where im.created_at < now() - interval '730 days' and exists (select 1 from public.lead_attachments la where la.message_id = im.id)),
    'eligible_text_messages', (
      select count(*) from public.inbox_messages im where im.created_at < now() - interval '730 days'
        and im.media_storage_path is null and im.dead_lettered_at is null and im.next_retry_at is null and im.retry_claimed_at is null
        and not exists (select 1 from public.lead_attachments la where la.message_id = im.id)
    ),
    'eligible_media_messages', (
      select count(*) from public.inbox_messages im where im.created_at < now() - interval '730 days'
        and im.media_storage_path is not null and im.dead_lettered_at is null and im.next_retry_at is null and im.retry_claimed_at is null
        and not exists (select 1 from public.lead_attachments la where la.message_id = im.id)
    ),
    'conversations_potentially_eligible_after_messages', (
      select count(*) from public.inbox_conversations c where c.updated_at < now() - interval '730 days'
        and not exists (select 1 from public.leads l where l.created_from_conversation_id = c.id)
        and not exists (select 1 from public.lead_attachments la where la.conversation_id = c.id)
        and not exists (select 1 from public.inbox_alerts al where al.conversation_id = c.id and al.is_resolved = false)
    ),
    'resolved_alerts_older_than_90d', (select count(*) from public.inbox_alerts where is_resolved = true and resolved_at < now() - interval '90 days'),
    'terminal_automation_runs_older_than_180d', (
      select count(*) from public.automation_runs
      where status in ('succeeded', 'partial', 'failed', 'skipped_conditions_not_met', 'blocked_permission')
        and finished_at is not null and finished_at < now() - interval '180 days'
    ),
    'ai_usage_events_older_than_730d', (select count(*) from public.ai_usage_events where created_at < now() - interval '730 days')
  );
$$;

-- 9. Grants - service_role only. No client role (including a tenant's own
--    authenticated session) may call any retention function; there is no
--    workspace_id argument to gate by permission because these are
--    cross-tenant maintenance operations, exactly like sla_sweep().

revoke all on function public.retention_delete_eligible_text_messages(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.retention_claim_media_messages_batch(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.retention_confirm_media_message_deleted(uuid) from public, anon, authenticated;
revoke all on function public.retention_release_media_claim(uuid) from public, anon, authenticated;
revoke all on function public.retention_delete_resolved_alerts(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.retention_delete_terminal_automation_runs(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.retention_delete_old_ai_usage_events(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.retention_delete_empty_old_conversations(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.retention_preview_counts() from public, anon, authenticated;

grant execute on function public.retention_delete_eligible_text_messages(timestamptz, integer) to service_role;
grant execute on function public.retention_claim_media_messages_batch(timestamptz, integer) to service_role;
grant execute on function public.retention_confirm_media_message_deleted(uuid) to service_role;
grant execute on function public.retention_release_media_claim(uuid) to service_role;
grant execute on function public.retention_delete_resolved_alerts(timestamptz, integer) to service_role;
grant execute on function public.retention_delete_terminal_automation_runs(timestamptz, integer) to service_role;
grant execute on function public.retention_delete_old_ai_usage_events(timestamptz, integer) to service_role;
grant execute on function public.retention_delete_empty_old_conversations(timestamptz, integer) to service_role;
grant execute on function public.retention_preview_counts() to service_role;

-- 10. Schedule retention-tick - DAILY (mirrors 20260927060000's pattern).
--     Shared secret generated in Vault; must be read out and set as
--     RETENTION_CRON_SECRET via `supabase secrets set` (uncommitted
--     deploy step, same as every prior *_CRON_SECRET). Safe to schedule
--     early: until that secret is set, the scheduled POST just 403s.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'retention_cron_secret') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'retention_cron_secret');
  end if;
end
$$;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'retention-tick' limit 1;
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
exception
  when undefined_table or invalid_schema_name then
    null;
end
$$;

-- 11. Privacy Policy version bump - deployed IN THE SAME RELEASE as this
--     retention policy taking effect (see src/pages/legal/Privacy.tsx's
--     "How long we keep information" section, updated in this same
--     commit, and src/lib/legalDocuments.ts's PRIVACY_POLICY_VERSION).
--     This is a plain UPDATE, never a DELETE/re-insert: every existing
--     legal_acceptances row for the OLD privacy_policy version is left
--     exactly as it was - that is still true, durable evidence that a
--     user accepted THAT version at THAT time. No existing user is made
--     to re-accept anything by this statement; a new signup (or any
--     future accept_current_legal_terms() call) simply records against
--     whatever version is current from this point on.
update public.legal_document_versions
set current_version = '2026-10-05', effective_at = '2026-10-05T00:00:00Z', updated_at = now()
where document_type = 'privacy_policy';

-- 03:17 UTC - off-peak, deliberately offset from the other daily/minutely
-- ticks so a slow retention pass never contends with them.
select cron.schedule(
  'retention-tick',
  '17 3 * * *',
  $$
  select net.http_post(
    url := 'https://doarqrjpadejksovxeev.supabase.co/functions/v1/retention-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'retention_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

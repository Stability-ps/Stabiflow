-- Phase 2 blocker D-1: a lead created FROM a conversation must receive
-- exactly ONE logical lead_created activity and lead.created domain event
-- once the conversion first reaches a fully-completed state - whether that
-- is the first attempt, a retry after any partial failure (link /
-- attribution / context / media), or a concurrent sibling create.
--
-- domain_events already enforces this via domain_events_dedupe_key_key on
-- dedupe_key (key = 'lead.created:<leadId>'; a lead is created once). The
-- append-only workspace_activity_log has no dedupe, so add a scoped
-- partial UNIQUE index: a lead is created exactly once, so its
-- lead_created activity row is unique on (workspace_id, target_id). This
-- constrains ONLY action = 'lead_created' AND target_type = 'lead' rows -
-- every other activity kind (notes, stage changes, links, ...) stays
-- freely repeatable, so no unrelated event semantics change.
--
-- Pre-deploy check (like leads_created_from_conversation_id_key): this must
-- return zero rows before the migration is pushed to a database that
-- already has activity history -
--   select workspace_id, target_id, count(*)
--   from public.workspace_activity_log
--   where action = 'lead_created' and target_type = 'lead'
--   group by 1, 2 having count(*) > 1;

create unique index if not exists workspace_activity_log_lead_created_key
  on public.workspace_activity_log (workspace_id, target_id)
  where action = 'lead_created' and target_type = 'lead';

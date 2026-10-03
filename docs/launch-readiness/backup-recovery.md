# Production backup / recovery readiness

Verified 2026-08-28 via the Supabase Management API (read-only checks
only - no plan changes, no purchases, nothing mutated).

## Current backup status (verified, not assumed)

Queried `GET /v1/projects/{ref}/database/backups` for the StabiFlow
project directly:

- `pitr_enabled: false` - Point-in-Time Recovery is **not** currently
  enabled on this project.
- `walg_enabled: true` - daily physical (WAL-G) backups are running.
  Five most recent backups confirmed, one per day, all `COMPLETED`.

**What this means in practice**: StabiFlow can be restored to any of the
last several daily backup points (a full-day granularity restore), but
**cannot** be restored to an arbitrary point in time within a day (e.g.
"5 minutes before the bad migration ran") without PITR. For a
pre-launch/pilot-stage project this is a reasonable baseline, but it is
the single most consequential upgrade to consider before real customer
data volume grows - a bad migration or accidental mass-delete today
loses up to a day of data, not seconds.

**One precise action for you to take**, since the exact PITR pricing/tier
availability for this Supabase plan cannot be determined via a read-only
API check: open the StabiFlow project in the Supabase dashboard ->
Settings -> Add-ons -> Point in Time Recovery, and confirm what retention
windows are available and their cost. This is a plan/billing decision,
not an engineering one - StabiFlow's code does not need to change to
benefit from PITR being enabled.

## Recovery procedures

### Database restore (physical/daily backup)
Dashboard -> Database -> Backups -> select a backup -> Restore. This is
a Supabase-dashboard-driven action; no CLI/code path exists or should
exist for this (restoring is inherently a human-supervised, rare,
high-stakes action).

### Migration hotfix procedure
1. Never edit an already-applied migration file in `supabase/migrations/`.
2. Write a NEW migration file with the next timestamp that corrects the
   issue (e.g. adds a missing index, fixes a trigger) - this repository's
   own history already follows this discipline (see
   `20260906060000_default_pipeline_lifecycle_fix.sql` and
   `20260908060100_fix_campaign_performance_query.sql` as precedent).
3. Test the new migration against a local/throwaway environment if the
   change is non-trivial, then `supabase db push` to apply it to
   production directly (there is currently no separate staging Supabase
   project - see the staging-strategy note below).
4. Never use `supabase db reset` or any destructive migration-replay
   command against the production project.

### Forward-only corrective migration procedure
Same as above - this codebase's entire migration history is already
forward-only (confirmed: no destructive `DROP TABLE`/`DROP COLUMN`
outside of clearly-scoped fix migrations that immediately recreate the
corrected version). Continue this discipline: a wrong migration is fixed
by a new migration, never by editing or deleting the old one.

### Vercel rollback procedure
Vercel keeps every previous deployment. To roll back:
`vercel rollback <deployment-url>` from an authenticated CLI, or via
Dashboard -> Deployments -> select a prior deployment -> "Promote to
Production". This is instant (DNS/edge routing change only, no rebuild)
and safe to do without engineering involvement once a bad deploy is
identified.

### Supabase Edge Function rollback/redeploy
Edge Functions are NOT automatically versioned the way Vercel deployments
are - redeploying is the rollback mechanism. To revert a bad function:
`git checkout <previous-good-commit> -- supabase/functions/<name>` then
`supabase functions deploy <name> --no-verify-jwt` (matching the exact
deploy pattern already used throughout Phase L-1). Keep this in mind: a
bad edge-function deploy is recovered by redeploying the last-good code,
not by any dashboard action.

### Secret recovery considerations
Function secrets (`OPENAI_API_KEY`, `INTEGRATIONS_META_APP_SECRET`,
`WHATSAPP_WEBHOOK_VERIFY_TOKEN`, cron secrets, etc.) are set via
`supabase secrets set` and are NOT recoverable by reading them back - the
Management API only returns secret *names*, never values (confirmed
during this audit - the list-secrets endpoint has no value field at all).
**Practical implication**: whoever owns these credentials (Meta App
dashboard, OpenAI account, the cron-secret generation) must keep their
own independent record - StabiFlow's own infrastructure cannot be used
to recover a lost secret value. If a secret is ever lost, it must be
regenerated at the source (rotate the Meta App secret, generate a new
OpenAI key, etc.) and re-set via `supabase secrets set`, which will
briefly interrupt whichever function depends on it until redeployed.

### Vault secret recovery
Per-workspace provider tokens (OAuth tokens, connection secrets) live in
Supabase Vault, written via `set_workspace_integration_secret` and never
readable back in plaintext by design (confirmed in
`supabase/tests/integrations-vault.test.ts` - even the workspace owner
cannot call the read/clear RPCs directly). If a workspace's connection
token is somehow corrupted or needs recovery, the only path is the
workspace owner reconnecting via Settings > Integrations (a fresh OAuth
flow), not a "restore the secret" operation - this is intentional
Vault design, not a gap.

### Incident-response sequence (recommended)
1. Identify the failure (a worker heartbeat/health check going stale is
   the primary detection signal - see the observability work in this
   same branch).
2. Determine blast radius: one workspace (isolated bug, likely code) vs.
   platform-wide (likely infra/deploy/secret issue).
3. If platform-wide and deploy-related: Vercel rollback (frontend) or
   Edge Function redeploy of last-good code (backend) - both are minutes,
   not hours.
4. If data-related: assess whether a migration hotfix (forward-only) is
   sufficient, or whether a backup restore is genuinely needed (a much
   more disruptive, dashboard-driven, last-resort action).
5. Communicate status to affected workspace(s) - no automated status-page
   mechanism exists yet; this is currently a manual step.

## Recommended future staging strategy

No staging Supabase project exists today - all migrations and edge
function deploys go directly against the single production project.
This is a reasonable and common approach at pilot scale, but as real
customers depend on the product, consider (not implemented, no project
created in this pass per explicit instruction not to create a second
production-like Supabase project without approval):

- A dedicated staging Supabase project mirroring production schema, used
  to test migrations and edge function changes before they touch real
  customer data.
- A staging Vercel deployment (Vercel already supports this natively via
  preview deployments per-branch - no new infrastructure needed on the
  Vercel side, only a second Supabase project to point a staging branch
  deployment's env vars at).

This is explicitly a **future recommendation**, not something built in
this pass - it would require creating new infrastructure, which is
outside what this launch-completion pass is authorized to do
unilaterally.

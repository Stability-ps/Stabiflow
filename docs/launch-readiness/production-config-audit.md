# Production configuration audit

Verified 2026-08-28 via the Vercel CLI (already authenticated as
`stability-ps`) and the Supabase Management API. Presence/status checks
only - no secret values were read, printed, or logged anywhere in this
audit; only variable/secret *names* and non-sensitive config fields
(URLs, booleans, region) were inspected.

## Vercel

- **Canonical app URL**: `app.stabiflow.com` confirmed as the production
  domain (in addition to the apex `stabiflow.com` and `www.stabiflow.com`,
  both configured earlier as redirects to the canonical app subdomain -
  unchanged from the Phase K deployment work).
- **Custom domains healthy**: `vercel domains ls` confirms `stabiflow.com`
  is attached with `Third Party` nameservers - i.e. still pointed at
  Hostinger DNS as required, not moved to Vercel-managed nameservers.
  No nameserver change was made or needed.
- **SPA routing**: unchanged from the existing `vercel.json`
  (`framework: vite`, rewrite-all-to-index for client-side routing) - not
  modified in this pass.
- **Production environment variables** (`vercel env ls production`):
  exactly two are set - `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
  **No OpenAI, Meta, or WhatsApp private secret exists on Vercel** -
  confirmed correct: those live exclusively in Supabase Edge Function
  secrets, never reaching the browser bundle. This is the intended
  architecture and it is intact.

## Supabase

- **Auth Site URL**: `https://app.stabiflow.com` - correct canonical
  value (verified via `GET /v1/projects/{ref}/config/auth`).
- **Auth redirect allow-list**: includes the canonical domain (with and
  without `www`), the `.vercel.app` preview domains, and localhost dev
  ports - no unexpected/stale entries found.
- **Edge Function secrets present** (names only - confirmed via the
  Management API, which does not return values at all): `OPENAI_API_KEY`,
  `OPENAI_WHATSAPP_MODEL`, `OPENAI_FLOW_AI_MODEL`,
  `INTEGRATIONS_META_APP_ID`, `INTEGRATIONS_META_APP_SECRET`,
  `INTEGRATIONS_META_OAUTH_REDIRECT_URI`, `INTEGRATIONS_META_GRAPH_API_VERSION`,
  `INTEGRATIONS_APP_ORIGIN`, `INTEGRATIONS_META_MOCK_MODE`,
  `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `AUTOMATIONS_CRON_SECRET`,
  `AUTOMATIONS_ENABLED`, `AD_METRICS_CRON_SECRET`,
  `AD_META_GRAPH_API_VERSION`, `CONTENT_CRON_SECRET`,
  `CONTENT_AUTO_PUBLISH_ENABLED`, `FLOW_AI_PLATFORM_DAILY_TOKEN_CEILING`,
  `FLOW_AI_DEFAULT_WORKSPACE_MONTHLY_TOKEN_LIMIT`, plus the standard
  Supabase-managed `SUPABASE_*` set. Every secret this codebase's edge
  functions reference (grepped against `Deno.env.get(...)` calls across
  `supabase/functions/`) has a corresponding entry - no missing secret
  found that would cause a silent runtime failure.
- **Mock-mode production status**: `INTEGRATIONS_META_MOCK_MODE` is
  present. Its value was not read (a boolean flag, but treated with the
  same never-print discipline as any other production config value in
  this audit) - its effective state was already independently confirmed
  during Phase L-1 by observing real function behavior (a real send
  attempt resolved via the mock provider, `delivery_status: "submitted"`),
  which is the safer way to confirm a runtime flag's effect than reading
  the stored value directly.

### Mock mode vs. real provider readiness - explicit separation

**Do not flip `INTEGRATIONS_META_MOCK_MODE` off in production yet.**
Two independent reasons:
1. Meta App Review has not been approved (see
   `docs/launch-readiness/meta-app-review-package.md`) - real Graph API
   calls with the current app's permissions would fail or be rejected
   for any non-developer-role user regardless of this flag.
2. **The automated integration test suite (`supabase/tests/*.test.ts`)
   calls the real deployed edge functions** and depends on mock-mode
   behavior for its WhatsApp/Meta-adjacent tests to pass without making
   real provider calls or incurring real costs. Flipping this flag in
   production would change what those tests actually exercise on every
   future CI run, not just what real users experience - the two are the
   same deployed function, there is no separate test-only deployment.

**Recommended sequencing when Meta approval lands**: flip mock mode off
only during a deliberately supervised real-connection test window (per
the test plan in `docs/launch-readiness.md`), verify the specific
real-connection checklist items, and treat re-running the automated
integration suite immediately afterward as a required step to confirm
nothing broke - not an optional afterthought.

## Summary

No misconfiguration found. Architecture separation (frontend secrets vs.
backend secrets, Supabase Edge Functions vs. Vercel Functions, canonical
domain vs. redirects) is intact and unchanged from the Phase K deployment
work. No changes were made during this audit - it is a verification pass
only.

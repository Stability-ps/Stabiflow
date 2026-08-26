# StabiFlow

**Create. Advertise. Connect. Convert.**
_From content to customers._

A multi-tenant SaaS platform for social content, Meta advertising,
WhatsApp lead management, and conversion attribution. See
[`docs/architecture/multi-tenancy.md`](docs/architecture/multi-tenancy.md)
for the tenant-isolation model this whole product is built on.

This repository is independent of Acapolite Consulting - separate Git
history, separate Supabase project, no shared credentials. It reuses
specific proven modules from that codebase (see the architecture audit)
but nothing here imports from or depends on the Acapolite repository at
runtime.

## Stack

Vite + React + TypeScript + Tailwind + shadcn/ui + TanStack Query +
Supabase (Postgres, Auth, Storage, Realtime, Edge Functions) + Deno edge
functions + Vercel.

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in your StabiFlow Supabase project's URL/anon key
npm run dev
```

## Supabase

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push          # apply migrations
npx supabase gen types typescript --linked --schema public > src/integrations/supabase/types.ts
```

Migrations live in `supabase/migrations/`, applied in filename order.
Every tenant-owned table has RLS enabled from the migration that creates
it - there is no window where a new table exists without a policy.

## Testing

```bash
npm test                 # unit/component tests (jsdom, offline)
npm run test:integration # cross-tenant RLS proof - hits a REAL Supabase project
```

`test:integration` requires `.env.test.local` (copy from
`.env.test.local.example`) with that project's service role key. It
creates two temporary users in two temporary workspaces, attempts
cross-tenant reads/writes/inserts/deletes as one against the other's data,
and asserts every one is blocked - then deletes both. **Never point this
at a project with real customer data.**

Before any *live/manual browser* testing (as opposed to the automated
suites above), see
[`docs/testing/browser-test-identity-safety.md`](docs/testing/browser-test-identity-safety.md) -
a shared browser can carry a real authenticated session across tabs,
and mutating test data under the wrong identity is a real failure mode,
not a hypothetical one.

## Security assumptions

- Tenant isolation is enforced by Postgres RLS, not frontend filtering.
  Every policy is built from `is_workspace_member()`/`has_workspace_role()`
  (see the architecture doc) - never an inline membership subquery.
- Provider secrets (Meta, WhatsApp tokens) are never environment
  variables and never plain columns - they live in Supabase Vault, one
  per `workspace_integrations` row, readable only by `service_role`
  (verified against this project's actual grants, not assumed).
- No production Acapolite data, secrets, RLS policies, or business logic
  were copied into this repository. Specific reusable *code* (Meta
  publishing, scheduling/idempotency, image-variant generation, WhatsApp
  AI/human-control logic) was ported and adapted; nothing was imported
  wholesale.

## Project status

Complete: repository foundation and workspace/authorization/attribution
schema; Content (media library, Facebook/Instagram variants, scheduling,
Content Calendar); Campaigns foundation; workspace-scoped Integrations
(Meta, WhatsApp, Vault-backed secrets, resource discovery); WhatsApp Inbox
(conversations, AI/human control, delivery statuses); Leads/Pipelines/
Opportunities/Customers (the generic conversion-management layer,
conversation-to-lead linking).

Next: Meta Paid Advertising Campaigns, then Attribution & Conversion
Tracking, Analytics, Flow AI, and the Automation Engine - see
[`docs/architecture/product-roadmap.md`](docs/architecture/product-roadmap.md)
for the full sequence and long-term product data flow,
[`docs/architecture/acapolite-reuse-strategy.md`](docs/architecture/acapolite-reuse-strategy.md)
for how existing Acapolite systems are (and aren't) reused,
[`docs/architecture/ai-architecture.md`](docs/architecture/ai-architecture.md)
for how AI credentials/features are meant to be structured (including the
WhatsApp AI vs. future Flow AI split), and
[`docs/architecture/automation-architecture.md`](docs/architecture/automation-architecture.md)
for the not-yet-built Automations module's intended shape.

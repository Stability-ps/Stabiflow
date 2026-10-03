# Business Studio platform release

Branch: `claude/stabiflow-creative-studio-continue-49wljp` (base `main` @ `8fd1c5e`).
This file is the draft PR description, the open-gap tracker and the production runbook.
Nothing here is live until the release order below has been followed.

## Summary

StabiFlow's focused public product - *give us your website, verify what we find, get a professional
company profile* - built on top of the existing platform. Existing modules (WhatsApp, Leads, CRM,
Pipelines, Meta Campaigns, Creative Studio, Content Scheduler, Attribution, Revenue, Flow AI,
Automations) are unchanged and remain available to every existing workspace; new workspaces see only
the launch navigation until an operator turns modules on.

### Business Identity (`20261011060000_business_identity.sql`)
- `business_identities` (one per workspace) + contacts, locations, social links, offerings, team,
  projects, certifications, country identifiers. Every fact has `source`, `source_ref`,
  `verification_status`; identity fields carry per-field provenance.
- `verified` is platform-only; a customer edit of a verified fact demotes it to `user_confirmed`.
- Branding is a pointer to `creative_brand_profiles` (not a copy). Legacy `workspace_settings`
  website/industry/description/contact columns are kept in sync both ways by depth-guarded triggers.
- Existing workspaces backfilled as `source='backfill'`, `unverified`.

### Plans, prices, entitlements (`20261012060000_plans_pricing_entitlements.sql`)
- Products, plans (free / one_off / subscription), immutable prices (once/month/year, ZAR cents,
  Paystack plan code per recurring price), entitlement definitions (boolean/limit/allowance), plan
  entitlements, subscriptions, purchases, operator overrides, monthly usage.
- One evaluator: `get_workspace_entitlements` (free -> live subscription -> paid purchases ->
  authoritative override). `consume_entitlement` is atomic, service-role only.
- Seeded indicative prices (launch configuration, editable in Admin): Professional Profile R299
  once-off; Business R249/month, R2,490/year; Growth R599/month, R5,990/year; Pro hidden.

### Feature flags (`20261013060000_feature_flags.sql`)
- `evaluate_feature_flags`: kill switch -> operator access -> workspace target -> everyone /
  operators-only / plan-targeted / staged % rollout (stable hash).
- Advanced modules targeted to the unsold `pro` plan at 0%; every workspace existing at migration time
  is grandfathered with explicit targets. Navigation, routes (`FeatureGate`) and `/app` home gated.

### Paystack (`20261014060000_paystack_billing.sql` + `billing-checkout`, `paystack-webhook`, `billing-actions`, `billing-reconcile-tick`)
- Grants happen only in row-locked, idempotent SQL functions keyed on OUR reference; amount/currency
  must match (underpayment -> `amount_mismatch`, no access). Renewals matched by stored subscription code.
- Webhook: HMAC-SHA512 over the raw body, sha256 dedupe, raw event log; invalid signatures never stored.
- Browser return triggers a server-to-server verify only - the redirect grants nothing.
- Lifecycle: active -> past_due -> grace (configurable days) -> expired; cancellation keeps access to
  period end; reconcile tick verifies lost webhooks and abandons stale checkouts.
- Mock mode is refused next to a live key.

### Business Studio (`20261016060000_business_studio.sql` + `business-studio`, `business-profile-public`, `website-monitor-tick`)
- SSRF-safe crawler (public unicast only on every hop, manual redirects, size/time caps, robots.txt,
  8 same-site pages / 45 s).
- Deterministic extraction (JSON-LD, meta, mailto/tel/wa.me/social) + AI extraction where every fact
  must be quoted verbatim from the page and contain its value; facts beside instruction-like text are
  dropped. Results are proposals only (`accept_business_fact_proposal` / `reject_...`).
- Paste-existing-profile text uses the same verified pipeline. AI wording improves only the customer's
  own text; new figures are rejected; proposals only; credit-metered.

### PDFs, hosted profiles, monitoring
- Deterministic A4 renderer (pdf-lib), 3 admin-editable designs, brand colours + logo, server-side
  watermark decision, document limit and premium designs enforced server-side, private bucket,
  content snapshots.
- Hosted profile `/b/:slug`: deliberate, entitlement-gated publish; `get_public_business_profile`
  exposes public, non-rejected facts only and hides the page if the subscription lapses; signed logo/PDF
  URLs; WhatsApp/email CTAs; QR.
- Website monitoring: changes become pending proposals, never overwrite approved information.

### Admin (`/app/operator`, `operator-admin`, `20261015060000_platform_admin.sql`, `20261017060000_legal_documents_cms.sql`)
Overview, Businesses & users, Plans & pricing, Feature flags, Subscriptions & payments, Business
Studio, Pages & legal, Settings & content, System & audit. Every mutation validated and written to
`platform_admin_audit` with before/after state; secrets shown only as configured/missing.

### Pages & legal
- Versioned legal documents (Privacy, Terms, Subscription terms, Refunds, Cookies, AI & data use,
  Data deletion): draft -> publish (immutable) -> superseded, effective dates, change summaries,
  publication history, public version history.
- Publishing Privacy/Terms moves the DB-authoritative `legal_document_versions` pointer; users who
  accepted an older version get a re-consent banner (`reaccept_current_legal_terms`, source
  `reconsent`). Until a version is published the existing in-code page is shown.
- Editable public copy: home headline/subtitle, public `/pricing` page intro, FAQs, support contact,
  platform notice banner.

### Security changes
- `workspace_billing.plan` / `limits` (incl. Inbox/Flow AI token caps) are no longer owner-editable.
- New tables all RLS-enabled; holdings, proposals, scans, documents, webhook events written only by
  service-role functions; cross-tenant FK references rejected by triggers.

### Migrations (apply in order)
`20261011060000`, `20261012060000`, `20261013060000`, `20261014060000`, `20261015060000`,
`20261016060000`, `20261017060000`. All apply cleanly from a fresh `supabase db reset`.
Two pg_cron jobs are created (`billing-reconcile-tick` every 15 min, `website-monitor-tick` daily);
they are rejected (403) until their secrets are set.

### Tests (at branch certification)
- `tsc -b`, `vite build`: pass. `oxlint`: 0 errors, pre-existing warnings only.
- Vitest: full suite green. Deno: all `_shared` tests green (image-processing suites need `--allow-ffi`
  with the local npm import-map substitution).
- New local integration suites: business-identity, plans-entitlements, feature-flags, paystack-billing,
  business-studio, legal-documents-cms (+ existing creative/legal suites) green.
- Environment-blocked here (network policy blocks esm.sh/deno.land for the local edge runtime):
  edge-function-backed integration suites and real edge-function E2E.
- Phone-width browser QA against the local stack; PDF visual QA of all three designs.

## Open gaps (not yet done)

| # | Gap | Status / classification |
|---|-----|--------------------------|
| 1 | Qonvertly consolidation | Repo not accessible to the build session. Paystack/state machine/AI ledger built natively. When access exists: narrow comparison of its Paystack adapter, subscription state machine, AI cost ledger, retry/job behaviour; port only what is materially better, otherwise document supersession and retire it. |
| 2 | Admin: Pages & legal | **Built** in this branch (see above). |
| 3 | Existing-profile file import (PDF/DOCX upload) | **Immediate post-launch enhancement.** Launch supports website scan, manual entry and pasted profile text only. |
| 4 | Real Paystack test-mode lifecycle | **Launch blocker.** Must run against a deployed environment with test keys (checklist below). |
| 5 | Real website scan / OpenAI E2E | **Launch blocker.** Must run against a deployed environment (checklist below). |

## Admin: owner operations without a developer

| Operation | No-code? |
|---|---|
| Change a public price | Yes - add a new price, deactivate the old (prices are immutable by design) |
| Create / hide / deactivate a plan | Partly - edit, hide and deactivate existing plans in Admin; creating a brand-new plan code needs `upsert_plan` (API exists; no "new plan" form yet) |
| Modify plan benefits / AI allowances | Yes (Plans & pricing -> What this plan includes) |
| Turn features on/off, staged rollout, per-workspace access | Yes (Feature flags; Businesses & users) |
| Inspect a customer / business / entitlements; grant or revoke | Yes (Businesses & users) |
| Troubleshoot billing (subscriptions, payments, webhooks, mismatches) | Yes (Subscriptions & payments) - read-only; refunds are issued in Paystack |
| Inspect AI costs | Yes (Overview; per-workspace in Businesses & users) |
| Inspect scan failures, documents, hosted profiles | Yes (Business Studio) |
| Manage profile designs | Availability / paid-only toggles yes; new layouts need code |
| Homepage headline, pricing intro, FAQs, support contact, notice | Yes (Pages & legal) |
| Policies / legal text, publish new version, history, acceptances | Yes (Pages & legal) |
| System health, failed jobs, secrets status, audit log | Yes (System & audit) |
| Set secrets, create Paystack plans, make someone an operator | **Developer/infra**: Supabase secrets; Paystack dashboard; `profiles.is_platform_operator` via SQL |
| Add a new entitlement type or feature flag key | **Developer**: migration (the evaluator then picks it up) |

## Production release order

1. Preserve/push source; open this draft PR; review.
2. Merge to `main`; confirm `main` contains the reviewed commits.
3. Migrations: check production `supabase_migrations` state and drift, take a backup, apply the seven
   migrations, then verify migration table, new tables/functions, RLS enabled, existing workspaces
   intact, grandfather targets created for every pre-existing workspace.
4. Secrets: `PAYSTACK_SECRET_KEY`, `APP_BASE_URL`, `BILLING_CRON_SECRET` (from vault
   `billing_cron_secret`), `WEBSITE_MONITOR_CRON_SECRET` (from vault `website_monitor_cron_secret`);
   re-check existing ones. Never in Git.
5. Paystack: create monthly + annual plans for Business and Growth; enter each `PLN_...` code on its
   price in Admin -> Plans & pricing. Confirm price economics.
6. Deploy edge functions: `billing-checkout`, `paystack-webhook`, `billing-actions`,
   `billing-reconcile-tick`, `business-studio`, `business-profile-public`, `website-monitor-tick`,
   `operator-admin`; set the Paystack webhook URL to `.../functions/v1/paystack-webhook`.
7. Deploy `main`; verify the deployed commit SHA.
8. Smoke tests (below) and log review.

### Paystack test-mode checklist
Checkout created -> redirect -> successful test payment -> callback (grants nothing by itself) ->
verified webhook -> reference reconciled -> entitlement granted -> duplicate webhook ignored ->
failed payment -> subscription created and linked -> renewal (if tooling permits) -> cancellation
(access to period end) -> grace/past-due via reconcile tick.

### Real scan checklist
Controlled site -> crawl -> extraction -> proposals with source URLs -> accept/correct -> AI wording
(usage recorded in `ai_usage_events`) -> save -> PDF. Plus: private-network URL refused, redirect to a
private address refused, planted prompt-injection text ignored, unsupported facts absent, failure
states shown.

### Production smoke tests
Landing, signup, auth, workspace creation; launch navigation (Home, Business Studio, My Business,
Documents, Billing, Settings) for new users; advanced modules hidden for new users, retained for
grandfathered workspaces and operators; identity edit/reload/isolation; Business Studio flow; PDF
purchase/export; hosted profile unpublished by default, explicit publish, QR, public-fact boundary,
lapse behaviour; Admin areas listed above.

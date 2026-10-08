# Product roadmap and long-term architecture

Durable direction recorded ahead of Phase F, so future sessions understand
where the product is going even before the detailed scope for a given
phase is supplied. When in doubt about how ambitious a change should be,
this document - not enthusiasm for a clean rewrite - is the tiebreaker:
prefer the smallest change consistent with this direction over a redesign,
per `acapolite-reuse-strategy.md`.

## Target product navigation

The intended mature StabiFlow product structure is approximately:

Dashboard, Content, Campaigns, Creative Studio, Inbox, Leads, Automations,
Analytics, Flow AI, Integrations, Settings.

Not every item needs to be exposed in the sidebar before it's real -
unfinished modules don't need placeholder nav entries ahead of their
phase.

## Long-term product data flow

```
CREATE       Content / Creative
  v
PUBLISH      Organic Facebook / Instagram
  v
ADVERTISE    Meta paid campaigns
  v
CONNECT      WhatsApp / other channels
  v
CONVERSE     AI + staff
  v
QUALIFY      Lead
  v
CONVERT      Opportunity -> Customer
  v
MEASURE      Attribution + revenue
  v
UNDERSTAND   Analytics
  v
OPTIMIZE     Flow AI
  v
AUTOMATE     Rules + AI-assisted actions
```

Every phase so far sits on this spine: Content (Create/Publish),
Integrations (Connect), WhatsApp Inbox (Converse), Leads/Pipelines/
Opportunities (Qualify/Convert). Phase F is Advertise; Phase G is Measure;
Phase H is Understand; Phase I is Optimize; Phase J is Automate.

## Phase F: Meta Paid Advertising Campaigns

The core model evolves toward:

```
Workspace -> Meta Integration -> Meta Ad Account -> Campaign -> Ad Set -> Ad -> Creative
```

Paid advertising stays **distinct from organic Content** (different
lifecycle, different risk profile - real money moves) but both share
workspace-owned media assets and platform variants where appropriate.
Don't duplicate media between the two systems.

### Campaign safety (money is real)

Paid advertising can spend real money, so Phase F must eventually enforce:

- explicit publish confirmation (no silent auto-publish)
- draft-first creation (a campaign exists as a draft before anything
  provider-side happens)
- server-side Meta calls only (never a direct client-to-Meta call)
- workspace authorization on every write
- idempotent publishing (same shape as Content's `idempotency_key`
  pattern - a retried publish must never double-spend)
- budget validation and currency correctness
- partial-failure handling (a multi-step publish - campaign, then ad set,
  then ad - that fails partway through must leave a recoverable, honest
  state, not a silently-broken one)
- provider-resource isolation (a workspace's campaign can only reference
  *that* workspace's ad account/page/creative - same workspace-consistency
  trigger pattern as every other module)
- activity logging into the shared `workspace_activity_log`

**Never create a real Meta paid campaign or incur advertising spend during
automated development or testing.** Any live verification of Phase F's
publish path must use Meta's mock/sandbox mode (the same
`INTEGRATIONS_META_MOCK_MODE` pattern Phase C established) unless the user
explicitly approves incurring real spend for a specific, named test.

## Phase G: Attribution & Conversion Tracking (future)

Phase F must preserve the identifiers and relationships this later phase
needs:

```
Campaign -> Ad Set -> Ad -> Creative -> Click/Engagement -> WhatsApp Conversation
  -> Lead -> Opportunity -> Customer -> Revenue
```

`attribution_events` already exists (Phase 2's schema) with the
`subject_type`/`subject_id` polymorphic hook this chain needs, and Phase
D's `inbox_conversations` already captures `referral_source`/
`referral_campaign_id`/`referral_ad_id`/`referral_headline` opportunistically
from Meta's click-to-WhatsApp referral data. Phase F should keep storing
real provider IDs and source metadata as it becomes available - **never
fabricate attribution** when the source is genuinely unknown (an organic
WhatsApp lead with no ad behind it is a normal case, not missing data).
Do not build the full attribution engine during Phase F unless separately
instructed - that's Phase G's job.

## Roadmap sequence

Unless a later discovery requires adjustment:

1. **Phase F** - Meta Ads Campaigns
2. **Phase G** - Attribution & Conversion Tracking
3. **Phase H** - Analytics & Reporting
4. **Phase I** - Flow AI (see `ai-architecture.md`)
5. **Phase J** - Automation Engine (see `automation-architecture.md`)
6. **Later** - Creative Studio expansion, additional ad providers
   (Google/TikTok - already stubbed as "coming later" in Integrations),
   billing/plans, agency/multi-client capabilities, onboarding
   improvements, production hardening.

## Commercial SaaS requirements to keep room for

Not built now, but architecture should not make these impossible later:

multi-workspace customers, multiple provider accounts, subscription
plans, usage limits, AI quotas (see `ai-architecture.md`), workspace
billing, audit logs (already have `workspace_activity_log`), team
permissions (already have the fine-grained `has_workspace_permission()`
pattern), agency/multi-client management, provider rate limits,
background jobs, retries, idempotency, observability, webhook replay
protection, data retention/deletion, privacy controls, production
monitoring.

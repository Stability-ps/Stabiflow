# Launch readiness

Tracks what stands between StabiFlow and real external companies safely
using it, first written up from the Phase K production-readiness audit
and the Phase L investigation, kept updated as each item closes. Nothing
in this document should be read as "already approved" or "already built"
unless explicitly marked done - see each section's status.

## Status legend

- **P0** - launch blocker (nothing real can happen without it)
- **P1** - required before first paying/external customers
- **P2** - can follow shortly after launch
- **P3** - later improvement

## Meta / WhatsApp production readiness

### Current permission set (as of Phase L-1)

Requested via `_shared/integration-providers/metaOAuth.ts`'s
`scopesForProvider()`:

**Meta (Facebook Pages / Instagram / Ads)** - `META_SCOPES`:
`pages_show_list`, `pages_read_engagement`, `pages_manage_posts`,
`instagram_basic`, `instagram_content_publish`, `business_management`,
`ads_management`, `ads_read`.

**WhatsApp management** (`whatsapp_business_management`) - list/read the
WhatsApp Business Account, its phone numbers, and (Phase L-1) its message
templates. Discovery only, never sending.

**WhatsApp messaging** (`whatsapp_business_messaging`, added Phase L-1) -
send/receive messages via the Cloud API. Required by every outbound send
path (`_shared/inbox/whatsappSend.ts`) and by the inbound webhook itself.
**Not requested before Phase L-1** - Phase C deliberately deferred it
(least privilege, connection/discovery only); Phase D then built the full
send/receive Inbox on top of the OLD scope set without ever adding it, a
real gap Phase L-1 closes.

### Approval status: NOT YET APPROVED

Requesting a scope in code does not grant it in production. Every scope
above requires Meta's Advanced Access / App Review approval before a real
(non-developer/tester-role) user can complete this OAuth flow
successfully - Standard Access only works for people with a role on the
StabiFlow Meta App itself. **As of this document, no App Review submission
has been made.** Do not represent Meta/WhatsApp integration as
production-ready to a real customer until this section is updated to say
otherwise.

### App Review submission checklist (prepared, not submitted)

The full per-permission submission package (feature, user journey,
screens, reviewer instructions, and what breaks without each scope) is in
`docs/launch-readiness/meta-app-review-package.md`. Summary sequence:

1. Verify the Meta Business Manager account tied to the StabiFlow Meta App
   (Business Verification - separate from App Review, required before
   `ads_management` works for real ad spend).
2. For each scope, prepare: a screen recording of the exact StabiFlow flow
   that uses it, and a written use-case description matching what the
   flow actually does (Meta reviews the use case, not just the scope
   name):
   - `pages_show_list`/`pages_read_engagement`/`pages_manage_posts`:
     Integrations page Meta connect -> Page selection -> Content module's
     publish-to-Facebook-Page flow.
   - `instagram_basic`/`instagram_content_publish`: same connect flow ->
     Instagram account selection -> Content module's publish-to-Instagram
     flow.
   - `business_management`/`ads_management`/`ads_read`: Integrations Meta
     connect -> Ad Account selection -> Campaigns module's campaign
     creation, publish, pause/resume, and metrics-sync flows.
   - `whatsapp_business_management`: Integrations WhatsApp connect ->
     WABA/number discovery -> (Phase L-1) template list sync.
   - `whatsapp_business_messaging`: Inbox module - receiving a real
     customer message via webhook, an AI or staff free-form reply within
     the 24-hour window, and a template send outside it.
3. Confirm whether a Data Deletion Request URL/callback is required for
   this app's scope combination (a standard Meta App Review checklist
   item for apps handling user data) and implement it if so - not yet
   investigated in code.
4. Submit for review. Typical turnaround 3-7 business days per round;
   budget calendar time, not engineering time, for this step.

### Real-connection test plan (after approval)

- Connect a real Page + Instagram Business account under a real Business
  Manager / Ad Account (not `INTEGRATIONS_META_MOCK_MODE`).
- Publish one real, small/tightly-capped-budget campaign end to end
  (existing `MAX_BUDGET_MINOR_UNITS` ceiling already in code), verify the
  full publish -> metrics-sync loop, then immediately pause it. This is
  also the first time `_shared/ad-providers/metaAdsErrorClassifier.ts`'s
  hardcoded error/rate-limit codes get validated against a real account -
  they are currently unverified (see that file's own header comment).
- Verify Click-to-WhatsApp referral payload shape against a real ad
  (`_shared/inbox/webhookMessageParser.ts`'s referral parsing is currently
  only mock-tested).
- Connect a real WABA/phone number, receive a real inbound message, send
  a real free-form reply within the window and a real template send
  outside it (see `docs/architecture/whatsapp-messaging-window.md`).

### 24-hour window / templates: CLOSED as of Phase L-1

See `docs/architecture/whatsapp-messaging-window.md` for the full
architecture. Summary: window state is computed from real inbound
customer-message evidence only, every outbound path is gated through the
same check, and approved-template discovery/selection/sending is built.
Deferred, explicitly out of scope for V1: authoring/submitting NEW
templates to Meta from StabiFlow (a separate Meta review process itself),
and automatic AI template sending (a closed window always hands off to a
human today - no deterministic, explicitly-approved use case exists yet
for the AI to choose and send a template on its own).

## Legal / privacy

**AI/OpenAI data-use disclosure is P0, not P2.** An earlier version of
this document's predecessor (the Phase K chat report) classified it as
P2 polish - that was wrong. Flow AI and WhatsApp AI both send real
workspace data (leads, conversations, revenue, campaign performance) to
OpenAI as a sub-processor. A real company cannot be onboarded without
disclosing this, alongside a Privacy Policy and Terms of Service - all
P0, alongside the Meta/WhatsApp approval gate above. None of this is
implemented yet; Phase L-1 corrects the classification and scope, and
does **not** draft the legal pages themselves (real legal text needs a
lawyer or a reviewed generator, not an AI-authored placeholder presented
as genuine legal assurance).

Also P0/P1, unchanged from the Phase K audit: workspace-deletion UI
(backend cascade already works - confirmed in Phase K - only the UI is
missing), a data-export step offered before deletion, and a stated
data-retention policy for WhatsApp messages/leads/revenue records
(currently: forever, since nothing purges anything - a real number needs
choosing and documenting, even if generous).

## Everything else from the Phase K audit

The full P0-P3 list from the Phase K production-readiness audit (billing,
admin/support tooling, observability, backup/recovery, onboarding UX, and
the remaining security/infra items not covered above) still stands as
delivered in that phase's report and is out of scope for Phase L-1 by
explicit instruction. This document currently only tracks the Meta/
WhatsApp and legal-classification items Phase L-1 directly touched;
folding the rest of the Phase K list into this file as living, versioned
documentation (rather than a one-time chat report) is recommended future
work, not done here.

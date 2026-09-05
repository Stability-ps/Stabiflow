# Meta App Review submission package

Prepared documentation for every permission StabiFlow's Meta integration
requests, grounded in the actual code (`_shared/integration-providers/metaOAuth.ts`).
**Nothing in this document has been submitted to Meta.** Approval status is
tracked in `docs/launch-readiness.md` - this file is the *content* to
submit when the user is ready, not evidence that submission happened.

For each permission: what StabiFlow feature needs it, the exact user
journey a reviewer should follow, what screens to show in the required
screencast, and what breaks without it. Meta reviews the *use case*, not
just the scope name, so each entry describes the real flow, not a generic
description.

---

## Facebook Pages

### `pages_show_list`
- **Feature**: Integrations page, Meta connect flow - Page selection step.
- **User journey**: Workspace owner/admin goes to Settings > Integrations,
  clicks "Connect Meta", completes the Meta OAuth dialog, and is shown a
  list of Facebook Pages they manage to choose which one StabiFlow
  publishes to.
- **Screens to demonstrate**: Integrations page (disconnected state) ->
  "Connect Meta" button -> Meta OAuth consent dialog -> redirect back to
  StabiFlow -> Page-selection screen showing the list.
- **Reviewer test instructions**: Use a test Business Manager with at
  least one Page. Connect it via Integrations. Confirm the Page appears
  in the selection list with its name.
- **Why necessary**: StabiFlow cannot show a user which Page to publish to
  without listing the Pages they manage.
- **What breaks without it**: The Page-selection step has nothing to
  populate - Meta/Content publishing cannot be configured at all.

### `pages_read_engagement`
- **Feature**: Same connect flow, requested alongside `pages_manage_posts`
  (Meta requires these together on current API versions for Page-level
  access) - used for Page health/discovery, not engagement metrics UI.
- **User journey**: Same as above - no separate user-visible step; this
  permission accompanies the Page connection itself.
- **Screens to demonstrate**: Same connect flow as `pages_show_list`.
- **Reviewer test instructions**: Same as above.
- **Why necessary**: Required by Meta's current API pairing rules for
  `pages_manage_posts` to function reliably.
- **What breaks without it**: Page publishing may be rejected or degraded
  by Meta's own API-level requirement, independent of StabiFlow's code.

### `pages_manage_posts`
- **Feature**: Content module - publish-to-Facebook-Page flow.
- **User journey**: Staff member creates a post in Content (media +
  caption), selects "Facebook" as a platform target, schedules or
  publishes immediately. StabiFlow's content-publish worker (or manual
  publish action) posts to the connected Page via the Graph API.
- **Screens to demonstrate**: Content > New Post -> compose with an
  image/caption -> select Facebook Page destination -> Publish -> the
  resulting live Facebook Page post.
- **Reviewer test instructions**: Create and publish one test post to a
  test Page; confirm it appears on the Page's timeline within Meta's own
  interface.
- **Why necessary**: This is the entire purpose of the Facebook side of
  the Content module.
- **What breaks without it**: No Facebook Page publishing at all - every
  publish attempt fails at the Graph API level.

## Instagram

### `instagram_basic`
- **Feature**: Integrations connect flow - Instagram Business account
  discovery (an Instagram Business account is always linked through its
  parent Facebook Page).
- **User journey**: After selecting a Page during Meta connect, StabiFlow
  looks up whether that Page has a linked Instagram Business account and
  shows it as an available publish destination.
- **Screens to demonstrate**: Same connect flow, Page-selection step ->
  the Instagram account (if linked) appears as an additional destination
  option.
- **Reviewer test instructions**: Connect a test Page with a linked
  Instagram Business account; confirm the Instagram account is detected
  and listed.
- **Why necessary**: Without read access, StabiFlow cannot even discover
  which Instagram account is available to publish to.
- **What breaks without it**: Instagram is never offered as a publish
  destination, even when a real linked account exists.

### `instagram_content_publish`
- **Feature**: Content module - publish-to-Instagram flow.
- **User journey**: Same compose flow as Facebook, with "Instagram"
  selected as the platform target - subject to Instagram's own content
  rules (image required, caption limits), which StabiFlow's platform
  rules already validate client-side before publish.
- **Screens to demonstrate**: Content > New Post -> select Instagram
  destination -> Publish -> the resulting live Instagram post.
- **Reviewer test instructions**: Publish one test post to a test
  Instagram Business account; confirm it appears on the account's feed.
- **Why necessary**: This is the entire purpose of the Instagram side of
  the Content module.
- **What breaks without it**: No Instagram publishing at all.

## Meta Ads (Business Manager)

### `business_management`
- **Feature**: Integrations connect flow - Ad Account discovery.
- **User journey**: During Meta connect, StabiFlow lists the Ad Accounts
  the user's Business Manager grants access to, so they can pick which
  one Campaigns publishes against.
- **Screens to demonstrate**: Connect flow -> Ad Account selection step.
- **Reviewer test instructions**: Connect a test Business Manager with at
  least one Ad Account; confirm it's listed with its name/currency.
- **Why necessary**: Ad Account discovery via Business Manager is
  materially more reliable than the equivalent unauthenticated lookup
  Meta's API otherwise requires.
- **What breaks without it**: Ad Account selection may fail to reliably
  enumerate accounts the user actually has access to.

### `ads_management`
- **Feature**: Campaigns module - campaign creation, publish, pause/resume.
- **User journey**: Staff member builds a campaign in StabiFlow
  (objective, budget, creative, targeting), clicks Publish; StabiFlow
  creates the corresponding real campaign/ad-set/ad via the Marketing
  API. Pause/resume actions call the same API to change status.
- **Screens to demonstrate**: Campaigns > New Campaign -> full builder
  flow -> Publish -> the resulting campaign visible in Meta Ads Manager
  -> Pause action in StabiFlow reflected in Ads Manager.
- **Reviewer test instructions**: Publish one small, tightly budget-capped
  test campaign end to end (existing `MAX_BUDGET_MINOR_UNITS` ceiling
  already enforced in code); confirm it appears in Ads Manager; pause it
  immediately after confirming the loop works. No sustained real spend.
- **Why necessary**: This is the entire purpose of the Campaigns module's
  write path.
- **What breaks without it**: No campaign creation/publish/pause - the
  module becomes read-only at best.

### `ads_read`
- **Feature**: Campaigns module - Ad Account/campaign metrics sync
  (scheduled `ad-metrics-sync` worker) and read-side discovery.
- **User journey**: Once a campaign is live, StabiFlow's Analytics and
  Campaigns pages show spend/performance data pulled periodically from
  the Marketing API.
- **Screens to demonstrate**: Campaigns > a live test campaign's detail
  view showing synced spend/impressions/clicks.
- **Reviewer test instructions**: After publishing the test campaign
  above, wait for one metrics-sync cycle (or trigger it manually if a
  test hook exists) and confirm numbers populate.
- **Why necessary**: StabiFlow's ROAS/attribution/analytics features
  depend entirely on real spend data from Meta.
- **What breaks without it**: Campaign performance data never updates;
  Analytics and ROAS calculations have no real spend to compare against.

## WhatsApp

### `whatsapp_business_management`
- **Feature**: Integrations WhatsApp connect flow - WABA and phone-number
  discovery, and (Phase L-1) message-template list sync.
- **User journey**: Workspace owner connects their WhatsApp Business
  Account via the same Meta OAuth dialog; StabiFlow lists the WABA(s) and
  phone number(s) available, and syncs the WABA's already-approved
  message templates for later use in the closed-window send flow.
- **Screens to demonstrate**: Integrations > Connect WhatsApp -> WABA/
  number selection -> (after connect) the Inbox's template picker showing
  synced templates.
- **Reviewer test instructions**: Connect a test WABA with at least one
  approved template; confirm the phone number and template both appear
  in StabiFlow.
- **Why necessary**: Read/discovery access is required before any send
  path can be configured at all.
- **What breaks without it**: No WhatsApp connection can be established -
  the entire WhatsApp Inbox module has nothing to attach to.

### `whatsapp_business_messaging`
- **Feature**: Inbox module - receiving a real customer message via
  webhook, an AI or staff free-form reply within the 24-hour window, and
  a template send outside it (all built in Phase L-1).
- **User journey**: A real customer messages the connected WhatsApp
  number; the message appears in StabiFlow's Inbox in real time; staff
  (or AI, if enabled) replies; the reply is delivered back to the
  customer's WhatsApp.
- **Screens to demonstrate**: A live inbound WhatsApp message appearing
  in Inbox -> a staff reply typed and sent -> the reply confirmed
  delivered on the actual WhatsApp client. Additionally: the same
  conversation after 24 hours with no new customer message, showing the
  closed-window UI and a template send instead.
- **Reviewer test instructions**: Send a real WhatsApp message to the
  test number from a personal device; confirm it appears in Inbox within
  seconds; reply from StabiFlow; confirm delivery on the device.
- **Why necessary**: This is the entire purpose of the WhatsApp Inbox
  module - without it, StabiFlow can discover a WhatsApp connection but
  never actually communicate through it.
- **What breaks without it**: No inbound message delivery, no outbound
  send capability at all (not even template sends, which also require
  this scope for the underlying Cloud API call).

---

## Business Verification

Required separately from App Review, before `ads_management` works for
real ad spend and before Advanced Access is granted for most of the
scopes above. Verifies the Meta Business Manager account tied to the
StabiFlow Meta App is a real, legitimate business. This is a Meta
Business Manager-side step (Business Settings > Business Verification),
not something StabiFlow's codebase can complete - see
`docs/launch-readiness.md` for the human-action checklist.

## Data Deletion Request requirement

See `/legal/data-deletion` (StabiFlow's public instructions page) and
`docs/launch-readiness.md`. StabiFlow's Meta integration is a
workspace/business-level connection, not a consumer Facebook Login flow -
no Meta user id is ever stored (confirmed by reading
`integrations-oauth-callback`). The instructions-page path is used;
`docs/launch-readiness.md` documents when a signed_request callback would
become necessary instead.

## Submission sequencing (human action)

1. Complete Business Verification in Meta Business Manager.
2. Record one screencast per permission group above (Pages, Instagram,
   Ads, WhatsApp can likely be combined into fewer recordings if the
   connect flow is shared - Meta accepts one recording covering multiple
   related permissions when the flow is genuinely shared).
3. Submit via App Review, pasting the per-permission use-case
   descriptions above.
4. Budget 3-7 business days per review round, per Meta's typical
   turnaround - calendar time, not engineering time.

**This package is submission-ready content. Submission itself is a human
action requiring your Meta Business Manager credentials - not something
this repository's automation performs.**

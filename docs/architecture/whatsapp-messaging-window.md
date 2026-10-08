# WhatsApp 24-hour messaging window (Phase L-1)

WhatsApp's Cloud API only allows a business to send a free-form
("session") message to a customer within 24 hours of that customer's most
recent message. Outside that window, the only deliverable outbound
message is an approved template. StabiFlow had no code awareness of this
rule before Phase L-1 - every send path assumed free-form was always
possible, which meant any real conversation older than a day would start
silently failing sends against the real Meta API. This document is the
authoritative reference for how the rule is now enforced.

## The one authoritative source

`supabase/functions/_shared/inbox/messagingWindow.ts` is the single place
that decides window state. It is deliberately built from the **real
inbound message log**, not a cached column, not `updated_at`, and never
anything staff/AI sent:

```
state = computeMessagingWindowState(lastCustomerMessageAt, now)
  where lastCustomerMessageAt = the newest inbox_messages row with
  direction='inbound' AND sender_type='customer' for this conversation
```

- `open` - `now <= lastCustomerMessageAt + 24h` (inclusive at the boundary)
- `closed` - past that
- `unknown` - no inbound customer message exists at all (a conversation
  seeded with no message history, or one where the log has somehow been
  lost) - **treated identically to `closed`** everywhere a send decision
  is made. This is a deliberate fail-closed default: StabiFlow must never
  guess a conversation is sendable.

`inbox_conversations.last_inbound_at` is a cached convenience column that
happens to track the same fact today, and the frontend uses a parallel,
display-only version of the same calculation
(`src/lib/inboxPresentation.ts`'s `computeMessagingWindowState`) against
it for the UI indicator. Neither is the enforcement path - only the
`_shared/inbox/messagingWindow.ts` query against `inbox_messages` is. The
browser is not the security boundary; a stale or manipulated frontend
value changes nothing about what the server will actually allow.

## Every outbound path is gated the same way

Two call sites, one shared check:

- **`inbox-actions`'s `reply` action** (staff manual free-form reply) -
  checks the window before saving or attempting anything. A closed/unknown
  window returns `409` with `code: "messaging_window_closed"` and never
  touches `inbox_messages` or the provider at all.
- **`whatsapp-webhook`'s `storeOutbound`** (every AI/system auto-reply:
  greetings, human-handoff acknowledgements, unsupported-message notices,
  and the main AI-generated reply) - same check, same fail-closed
  behavior. In today's call graph this path is only ever reached in direct
  response to the customer message that JUST reopened the window, so it
  is structurally always `open` here - the check stays in place anyway as
  the deterministic, future-safe seam (a delayed retry, or any future
  trigger, must go through the exact same policy, never an assumption
  based on how it got there).

When `storeOutbound` finds a closed/unknown window, it does **not**
silently drop the reply and does **not** send any message (not even an
apologetic system one - nothing is deliverable outside the window). It
hands the conversation to a human (`status='human_handoff'`,
`ai_enabled=false`) and inserts what the AI *would* have said directly
into the message thread with `delivery_status='blocked_window_closed'` -
visible to staff exactly where they're already looking, with a status
that unambiguously means "never sent," never a fabricated success.

## Templates: the only way to send outside the window

`whatsapp_message_templates` (migration
`20260913060000_whatsapp_message_templates.sql`) mirrors a workspace's own
**already-approved** templates from Meta - StabiFlow does not author or
submit templates to Meta in V1; that is a separate Meta review process of
its own and out of scope here. Sync reuses the existing "Refresh
resources" discovery trigger
(`_shared/integration-providers/discoverAndStore.ts`): for every WABA a
workspace owns, `GET /{waba_id}/message_templates` is fetched alongside
phone-number discovery, and each template is upserted keyed on Meta's own
`provider_template_id` (globally unique, same collision discipline as
every other provider-resource table - a template id already claimed by a
different workspace is skipped, never reassigned).

Sending a template (`inbox-actions`'s `reply_template` action) walks
through, in order:

1. authenticate/authorize the caller (same `bearerToken` +
   `hasWorkspacePermission(..., "inbox.manage")` as `reply`)
2. resolve the conversation (same cross-workspace `workspace_id` guard
   every other action in this dispatcher already applies)
3. resolve the workspace's own WhatsApp credential
   (`resolveCredential`, scoped to `conversation.whatsapp_number_id` -
   never a global token/number assumption)
4. look up the template **by id AND workspace_id** - a template id
   belonging to a different workspace resolves to nothing, not a leak
5. validate eligibility (`_shared/inbox/templateValidation.ts`):
   `provider_status === 'APPROVED'`, a real `language`, and the caller's
   parameter count matching the template's own `{{n}}` placeholders in
   its BODY component (counted from Meta's own stored `components`
   structure, never a hand-maintained schema)
6. send via the provider seam (see below), persist the resulting
   `inbox_messages` row (`message_type='template'`) with
   `provider_message_id`/`delivery_status`, and log the same
   `workspace_activity_log` trail every other dispatcher action gets

A template send is permitted **regardless of window state** - it is not
forced to wait for a closed window; Meta itself does not require that,
and there is no reason to withhold a template from a workspace that wants
to send one while the window happens to be open too.

## Mock provider (no real WhatsApp message required for tests)

Before this phase, `sendWhatsAppText` had no mock at all - every prior
test exercised the FAILURE path (a fake token making a real Graph API
call fail), never a genuine success. `_shared/inbox/whatsappSendProvider.ts`
/`whatsappSendMock.ts` add the same real/mock provider seam every other
Meta-backed module in this codebase already has
(`_shared/ad-providers/metaMarketingApiMock.ts` is the direct precedent),
selected by the same `INTEGRATIONS_META_MOCK_MODE` flag, decided by the
calling edge function - never a hidden fallback. This is what lets
`supabase/tests/whatsapp-messaging-window.test.ts` prove the window/
template logic genuinely succeeds on a real send attempt, without a real
Meta API call or a real customer-facing message.

## Production requirement: the `whatsapp_business_messaging` scope

Every send path above requires the `whatsapp_business_messaging` OAuth
scope, added in this phase to `WHATSAPP_SCOPES`
(`_shared/integration-providers/metaOAuth.ts`) alongside the pre-existing
`whatsapp_business_management`. See `docs/launch-readiness.md` for the
current Meta App Review / Advanced Access approval status - requesting
the scope in code does not grant it in production by itself.

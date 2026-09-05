# Automation architecture (future)

StabiFlow will eventually include a dedicated **Automations** module.
**It is not built yet, and must not be built without explicit instruction
in a later phase.** This document exists so earlier phases don't make
choices that foreclose it - stable event/entity IDs, real audit logging,
idempotent writes - all of which Phases C-E already do as a matter of
course, not as automation-specific work.

## Event-driven architecture to preserve

Future automations react to real system events. Preserve room for
(non-exhaustive) events like:

- `conversation.started`, `message.received`, `conversation.human_takeover`
- `lead.created`, `lead.qualified`, `lead.stage_changed`
- `opportunity.created`, `opportunity.won`, `opportunity.lost`
- `content.published`
- `campaign.published`, `campaign.performance_changed`
- `customer.created`

Nothing needs to *publish* these events yet. What matters now is that the
actions those events would represent (creating a lead, changing a stage,
marking an opportunity won) already go through a single server-side
dispatcher per module (`inbox-actions`, `leads-actions`,
`pipelines-actions`, and their Campaign-module equivalents) rather than
ad-hoc client writes - that's the seam a future event emitter attaches to
without a rewrite.

## The automation model

```
Trigger -> Conditions -> Actions
```

Examples of the shape (not built, illustrative):

```
WHEN new WhatsApp conversation
IF intent = sales
THEN create lead -> assign salesperson -> notify salesperson

WHEN lead remains untouched for 2 hours
THEN notify assigned salesperson

WHEN opportunity becomes Won
THEN create customer -> record conversion event -> trigger follow-up workflow

WHEN campaign performance deteriorates
THEN Flow AI analyses performance -> creates recommendation
      (never: automatically change campaign budget - see ai-architecture.md's AI safety section)
```

## Action types - keep AI actions and deterministic actions distinct

Future deterministic action types (executed by server-side code, not by
raw AI output - see `ai-architecture.md`):

- create lead, update lead, assign member, move stage
- create opportunity, create customer
- create internal note
- send notification
- schedule follow-up
- trigger an approved WhatsApp action
- request Flow AI analysis (the AI-adjacent action - it asks for a
  recommendation, it does not itself act)

## Idempotency requirement

One event must never accidentally: create two leads, create two
opportunities, send duplicate messages, assign multiple times, or record
duplicate conversions. This is why current-phase work already threads
stable, reusable identifiers through everything it touches (e.g. Meta's
`idempotency_key` on campaign publish operations, WhatsApp's
`provider_message_id` uniqueness, the `customers` table's
one-per-opportunity unique index) - preserve that discipline in every
future phase so the eventual automation layer has real anchors to key
off, not something bolted on after the fact.

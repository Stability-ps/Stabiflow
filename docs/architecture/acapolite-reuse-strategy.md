# Acapolite reuse strategy

StabiFlow is **not** a greenfield rewrite. Two existing Acapolite systems
are treated as **source implementations** to port from - not rebuilt from
scratch, and not architecturally ignored just because a later phase makes
building something "the StabiFlow way" tempting.

This rule is durable: it applies to every future phase, not only the ones
that have already used it (Phase C/D Integrations+Inbox, Phase E Leads).

## The two source systems

**Acapolite Campaign / Social platform** - reuse/adapt where appropriate:

- campaign structure, campaign items, scheduling, scheduler settings, excluded dates
- media relationships, Facebook/Instagram platform variants
- publishing, publish attempts, idempotency
- Meta provider abstractions, error classification, connection health
- existing campaign/content UI interaction patterns

**Acapolite WhatsApp platform** - reuse/adapt where appropriate:

- inbound message processing, conversation handling
- the AI/human control state machine
- staff replies, AI replies
- webhook security, delivery statuses, duplicate/out-of-order callback handling
- Inbox interaction patterns (take over, return to AI, resolve/reopen, internal notes)

Both are read-only reference material. The Acapolite-Consulting codebase
lives outside this repository, is never modified, and StabiFlow never
imports from it or points at its infrastructure at runtime.

## What is never copied

- Acapolite production data, credentials, or customer/conversation content
- Its single-company RLS model (StabiFlow is multi-tenant from the schema up)
- Global Meta/WhatsApp credentials (StabiFlow's are Vault-backed, one per
  `workspace_integrations` row)
- Hardcoded admin/user assumptions
- Tax-specific terminology or workflow assumptions (Acapolite is a tax/
  accounting practice; StabiFlow serves dealerships, solar, restaurants,
  agencies, and other SMEs equally)

## Required process before rewriting something that already exists in Acapolite

Inspect the Acapolite implementation first and classify each relevant
component as one of:

1. **reuse unchanged** - the logic is source-agnostic and workspace-safe as-is
2. **reuse with workspace adaptation** - the shape is right, but it needs
   `workspace_id` scoping, `has_workspace_permission()`-based RLS instead of
   a global role check, or similar tenant-isolation changes
3. **rewrite because of documented incompatibility** - state _why_ reuse
   doesn't work (e.g. "Acapolite's priority-escalation trigger assumes a
   single support team, StabiFlow's doesn't")
4. **intentionally leave behind** - a feature that's genuinely
   tax/Acapolite-specific and doesn't generalize (e.g. its intake
   question-ladder, service_request bridge)

Prefer 1/2 over 3/4. A phase's completion report should say which
components were classified which way and why - see the Phase D and Phase E
completion reports for the pattern.

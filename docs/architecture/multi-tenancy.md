# Multi-tenancy architecture

StabiFlow is a multi-company SaaS product. Every tenant-owned row belongs
to exactly one **workspace**, and workspace membership - not any global
role - is the entire authorization model. This document records the
decisions behind that model and why they were made this way, so later
phases extend it consistently instead of re-deriving it.

## Why not copy Acapolite's RLS model

Acapolite (the reference codebase this product was scoped from) enforces
authorization with a single `profiles.role` enum checked via
`get_my_role() = 'admin'` in every RLS policy. That's correct for a
single-company install and structurally wrong for a multi-tenant one: it
answers "is this person an admin of the one company that owns this whole
database," which doesn't distinguish between companies at all. None of
that predicate was reused - only the *pattern* (RLS on every table, a
`SECURITY DEFINER` helper function as the predicate, one policy per
table/operation) survived the move.

## The tenant boundary: `workspaces` + `workspace_members`

- `workspaces` - one row per customer company.
- `workspace_members` - `(workspace_id, user_id, role)`. A user can belong
  to multiple workspaces (the agency use case) with a different role in
  each.
- `profiles` - deliberately **not** workspace-scoped. A person's name
  doesn't change depending on which workspace they're viewing.

Every other tenant-owned table (campaigns, media assets, conversations,
leads, etc. - most land in Phases 5-9) carries a `workspace_id` column and
an RLS policy built from the helpers below. There is no table in this
schema that is both tenant-owned and missing a `workspace_id`.

## Centralized authorization helpers

Three `SECURITY DEFINER`, `STABLE` SQL functions
(`20260824060200_workspace_authorization_helpers.sql`) are the *only*
place workspace membership/role logic is expressed. Every RLS policy
calls one of these rather than re-deriving the predicate inline:

- `is_workspace_member(workspace_id)` - any role.
- `has_workspace_role(workspace_id, min_role)` - role seniority check via
  an explicit rank table (`workspace_role_rank`), not enum declaration
  order.
- `has_workspace_permission(workspace_id, permission)` - a fine-grained
  check against `workspace_role_permissions`, a real table (not a
  hardcoded `CASE`) so granting a new permission to a role is a data
  change with an audit trail, not a function redeploy.

`SECURITY DEFINER` matters here specifically because a policy *on*
`workspace_members` calling a function that reads `workspace_members`
would otherwise recurse through RLS again; running as the function owner
breaks that cycle.

## The bootstrap problem, and how it's closed

"Can I insert a `workspace_members` row for myself" can't be authorized by
`is_workspace_member`/`has_workspace_role` - there's no membership yet to
check. Rather than solve this with a permissive INSERT policy (which
would let anyone insert *any* membership row for *any* workspace), two
`SECURITY DEFINER` RPCs own the only two ways a membership row is ever
created:

- `create_workspace(name, slug)` - inserts the workspace and the caller's
  `owner` membership in one transaction.
- `accept_workspace_invitation(token)` - validates the invitation
  (pending, not expired, email matches the caller) and inserts the
  membership.

`workspace_members` has no client-facing INSERT policy at all. Every
membership row in the database was created by one of these two audited
functions.

## Provider secrets: Supabase Vault, verified before use

Before committing to Vault, its actual grants were checked against the
live project rather than assumed:

```sql
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'vault';
-- only `postgres` and `service_role` have SELECT on vault.secrets /
-- vault.decrypted_secrets. `anon` and `authenticated` have no grant at
-- all.
```

That confirms a decrypted secret can never reach the browser, even
accidentally, because PostgREST (which is what `anon`/`authenticated`
actually talk to) has nothing to expose. `workspace_integrations.vault_secret_id`
points at a Vault secret; the raw token is never a plain column anywhere.

Read/write access is further narrowed to two functions,
`set_workspace_integration_secret`/`get_workspace_integration_secret`,
with `EXECUTE` explicitly revoked from `anon`/`authenticated` and granted
only to `service_role`. So even a bug that exposed one of these as a
client-callable RPC would still fail at the database layer.

## workspace_integrations vs. provider resources

A `workspace_integrations` row represents *one connection to a provider*
(Meta, WhatsApp) - not the individual assets that connection grants access
to. Those live in their own tables:

- `workspace_facebook_pages`
- `workspace_instagram_accounts`
- `workspace_meta_ad_accounts`
- `workspace_whatsapp_numbers`

A workspace can have one Meta integration and several connected Facebook
Pages through it. `workspace_whatsapp_numbers.phone_number_id` is
globally unique (Meta-assigned) and is exactly the webhook routing key: an
inbound WhatsApp webhook carries this id in its payload, and looking it up
here is how a multi-tenant webhook receiver finds "which workspace does
this belong to" - never an assumption that there's only one.

## Attribution: raw events, not one campaign id per lead

`attribution_events` is an append-only, workspace-scoped log of
touchpoints (`ad_click`, `conversation_started`, `lead_created`,
`stage_changed`, `opportunity_created`, `customer_won`, ...). Every field
that names a source (`platform`, `external_campaign_id`,
`external_adset_id`, `external_ad_id`, `external_creative_id`) is
nullable, because an organic WhatsApp message with no ad behind it is a
normal case, not missing data - it just gets `platform = 'organic'` and
null campaign fields.

`subject_type`/`subject_id` reference downstream entities (conversation,
lead, opportunity, customer) by convention rather than a hard foreign key,
because those tables don't exist yet as of Phase 3 - they land in Phase 8.
Preserving the raw event stream now, before those tables exist, is the
point: real multi-touch attribution modelling can be built later as a
pure query over this table, with zero data migration, because nothing was
collapsed to "one campaign id" along the way.

## Role model

```
owner (100) > admin (90) > manager (70) > {marketing, sales, support} (50) > viewer (10)
```

Marketing/sales/support are peers (specialist roles), not a hierarchy
relative to each other - a manager can do what any of them can, plus more.
The numeric gaps are deliberate spacing for inserting a role later without
renumbering everything.

## What's still open (Phase 4+)

- Fine-grained `workspace_role_permissions` seeding is a reasonable V1
  default, not finalized - review against real usage once Content/
  Campaigns/Inbox exist.
- `attribution_events.subject_type` will likely get a real FK/CHECK
  constraint once the referenced tables exist (Phase 8/9).
- Team invitation email delivery (the actual "send an email with the
  token" step) isn't built yet - `accept_workspace_invitation` exists and
  is tested at the RPC level, but nothing calls it from a UI yet.

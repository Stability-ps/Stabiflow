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

## Role escalation: found and closed before Phase 4 UI work

A pre-Phase-4 architecture review flagged that `has_workspace_role()` (a
rank/hierarchy helper) was being used in `workspace_members`'s
admin-management RLS policies as if it also proved *authority to grant a
specific role* - it doesn't. Reasoning through the exact predicate found
two real, exploitable gaps, closed in
`20260825060000_prevent_role_escalation.sql`:

1. **Self-promotion.** The original `workspace_members_update_admin`
   policy only checked `has_workspace_role(workspace_id, 'admin')` in
   `USING`/`WITH CHECK` - which is true for the *caller's own* row. An
   admin could `UPDATE workspace_members SET role = 'owner' WHERE user_id
   = auth.uid()` and it would pass. Same gap let an admin promote a peer
   admin to owner.
2. **Invitation over-grant.** The invitation INSERT/UPDATE policies had
   the identical gap: any admin could create an invitation offering the
   `owner` role to an arbitrary email, with no check that the caller
   actually outranked what they were handing out.

The fix introduces two purpose-built predicates instead of reusing
`has_workspace_role` for this:

- `can_manage_member_with_role(workspace_id, current_role)` - used in
  `USING` clauses (which see the row's OLD state on UPDATE/DELETE).
  Requires the caller to be admin+ **and** to strictly outrank the row's
  *current* role. This is what stops both self-promotion and
  admin-vs-admin promotion: an admin (rank 90) never strictly outranks
  another admin (rank 90).
- `can_grant_workspace_role(workspace_id, new_role)` - used in
  `WITH CHECK` clauses (which see the NEW row state). Requires the caller
  to be admin+, to be at least as senior as the role being *granted*, and
  additionally requires the caller to already be 'owner' if the role
  being granted is 'owner'. Applied to both direct membership updates and
  invitation creation, so the same rule governs both paths into a role.

A related time-of-check/time-of-use gap in `accept_workspace_invitation()`
was closed the same way: an invitation offering 'owner', once created,
could previously still be honored even if the inviter's own ownership was
revoked before the invitation was accepted. The function now re-checks
that the inviter *currently* holds 'owner' at accept-time, not just at
invitation-creation time, and revokes the invitation if not.

`supabase/tests/role-escalation.test.ts` (17 tests, run against the live
project) proves both fixes and their boundaries - including that the
fix is not over-broad (the actual owner can still manage subordinates,
and an admin can still adjust lower-ranked members).

This is the concrete case for the standing rule stated at the top of this
document and reiterated for Phase 4: `has_workspace_role()` proves rank,
not authority over a specific target. Any future RLS policy that grants,
revokes, or otherwise acts on another member's role needs one of the two
predicates above (or a similarly explicit strictly-outranks check), never
a bare `has_workspace_role()` call.

## What's still open (Phase 4+)

- Fine-grained `workspace_role_permissions` seeding is a reasonable V1
  default, not finalized - review against real usage once Content/
  Campaigns/Inbox exist.
- `attribution_events.subject_type` will likely get a real FK/CHECK
  constraint once the referenced tables exist (Phase 8/9).
- Team invitation email delivery (the actual "send an email with the
  token" step) isn't built yet - `accept_workspace_invitation` exists and
  is tested at the RPC level, but nothing calls it from a UI yet.

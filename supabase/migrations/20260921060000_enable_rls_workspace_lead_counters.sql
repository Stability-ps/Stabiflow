-- Security Advisor fix: "RLS Disabled in Public" on
-- public.workspace_lead_counters.
--
-- Root cause: the table was created in 20260901060000_leads_pipelines_schema
-- (section 3) without `enable row level security`, unlike every sibling
-- table in that same migration (pipelines, pipeline_stages, leads,
-- opportunities, customers, crm_notes all enable RLS). Because Supabase
-- exposes every public-schema table through PostgREST and grants
-- authenticated/anon the usual table DML privileges, an RLS-less
-- workspace_lead_counters is directly reachable by ANY authenticated user
-- of ANY workspace - they could read every tenant's `last_value` (leaks
-- how many leads each workspace has) or UPDATE/DELETE it (corrupts another
-- tenant's LEAD-000123 numbering). Cross-tenant, low severity, but real.
--
-- Access model: workspace_lead_counters is PURELY INTERNAL bookkeeping.
-- Its ONLY accessor is public.next_lead_reference(p_workspace_id) - a
-- SECURITY DEFINER function - invoked solely by the leads BEFORE INSERT
-- trigger leads_assign_human_reference_trg. No client code, edge function,
-- or other DB routine reads or writes this table directly; the resulting
-- reference is denormalised onto leads.human_reference (already readable
-- via the existing leads_select policy). There is therefore NO legitimate
-- direct client access to grant.
--
-- Fix: enable RLS with NO policies -> deny-by-default for authenticated/
-- anon. SECURITY DEFINER functions run as the table owner and are not
-- subject to RLS (no FORCE ROW LEVEL SECURITY here), and service_role
-- bypasses RLS, so next_lead_reference() and every leads-actions insert
-- keep working unchanged. This mirrors the "server creates, RLS denies
-- direct client access" posture the codebase already uses for
-- backend-authoritative tables.

alter table public.workspace_lead_counters enable row level security;

-- Deliberately no policies: this table is never queried directly by a
-- browser client. Adding a workspace-scoped SELECT policy would only
-- satisfy the linter's "no policies" nag while widening the surface for
-- zero product benefit - the human reference is already available on
-- public.leads. If a future feature genuinely needs to show a workspace
-- its current counter, add a narrow
-- `has_workspace_permission(workspace_id, 'lead.view')` SELECT policy then,
-- not now.

comment on table public.workspace_lead_counters is
  'Internal, backend-only per-workspace sequence for human-readable lead references (LEAD-000001). Written exclusively by the SECURITY DEFINER function next_lead_reference() via the leads BEFORE INSERT trigger. RLS is enabled with no policies: direct authenticated/anon access is denied; SECURITY DEFINER + service_role paths are unaffected.';

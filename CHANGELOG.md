# Changelog

## Phase 1-3 - Foundation, Supabase architecture, auth & multi-tenancy

- Repository scaffolded (Vite + React 19 + TypeScript + Tailwind + shadcn/ui + TanStack Query + React Router).
- New, independent Supabase project (`StabiFlow`, region `eu-central-1`, org `Acapolite Consulting`) - never Acapolite's production database.
- Workspace core schema: `workspaces`, `workspace_members`, `workspace_invitations`, `workspace_settings`, `workspace_billing`, `profiles`.
- Centralized authorization helpers: `is_workspace_member()`, `has_workspace_role()`, `has_workspace_permission()` (backed by a `workspace_role_permissions` table), plus bootstrap RPCs `create_workspace()` and `accept_workspace_invitation()`.
- `workspace_integrations` (Supabase Vault-backed secret storage, verified against this project's actual grants before use) kept separate from provider resources: `workspace_facebook_pages`, `workspace_instagram_accounts`, `workspace_meta_ad_accounts`, `workspace_whatsapp_numbers`.
- `attribution_events` - raw, append-only touchpoint log, source-agnostic and nullable-by-design, so multi-touch attribution can be built later without a data migration.
- `workspace_activity_log` - audit log, ported pattern from Acapolite's `system_activity_log`.
- Minimal auth UI: sign up, sign in, create workspace, workspace switcher.
- RLS enabled on every tenant-owned table from the migration that creates it.
- 16 cross-tenant isolation integration tests (`npm run test:integration`), run against the real, live StabiFlow Supabase project - all passing, cleanup verified.

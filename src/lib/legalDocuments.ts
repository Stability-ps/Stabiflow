// Single frontend source for the legal document versions/paths shown to
// users. Presentation only: the actual acceptance record (see
// legalAcceptance.ts) is written by accept_current_legal_terms(), which
// reads its own copy from the DB-authoritative public.legal_document_versions
// table, NOT from these constants - a browser value is never trusted as
// "the current version" for evidence purposes. Keep these in sync with the
// seed rows in supabase/migrations/20261004060000_legal_acceptance_tracking.sql
// whenever a legal page's effective date changes.
export const PRIVACY_POLICY_VERSION = "2026-09-04";
export const TERMS_OF_SERVICE_VERSION = "2026-08-28";

export const PRIVACY_POLICY_PATH = "/legal/privacy";
export const TERMS_OF_SERVICE_PATH = "/legal/terms";
export const DATA_DELETION_PATH = "/legal/data-deletion";

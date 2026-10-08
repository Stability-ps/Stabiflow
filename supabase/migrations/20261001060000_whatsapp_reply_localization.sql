-- Phase 13 - WhatsApp reply localization / customer language matching.
--
-- Optional, presentation-only. When a workspace opts in, an AI-generated
-- WhatsApp reply (legacy or structured-intake path) gets ONE extra OpenAI
-- pass that rewrites it into the customer's conversational language /
-- South African code-mix. The ORIGINAL semantic reply stays authoritative:
--   * intake extraction / merge / completion happen BEFORE localization
--   * deterministic guards (extractProtectedTokens / validateLocalizedReply
--     + the existing containsFalseActionClaim / containsInventedPersonalIdentity)
--     reject any candidate that mutates a URL / amount / phone / email /
--     reference / date, expands unreasonably, invents an action, or invents
--     a human identity -> the original reply is sent instead.
--   * failure / timeout / malformed output -> original reply.
--   * localization NEVER runs while the conversation is human-controlled,
--     for system / template / automation / outside-hours messages, or when
--     normal AI generation did not run.
--   * localization tokens are recorded in the EXISTING ai_usage_events
--     ledger (feature = 'whatsapp_reply_localization') and count toward the
--     SAME per-workspace monthly Inbox AI allowance - no new ledger.
--
-- Schema change is a single boolean opt-in, mirroring ai_multimodal_enabled
-- (Phase 6) and ai_voice_transcription_enabled (Phase 10): default OFF,
-- member-readable via workspace_settings' existing select RLS
-- (is_workspace_member), admin-writable via its existing update RLS
-- (has_workspace_role(workspace_id, 'admin')). No new table, no new
-- permission, no new domain event.

alter table public.workspace_settings
  add column if not exists match_customer_language boolean not null default false;

comment on column public.workspace_settings.match_customer_language is
  'Phase 13: when true, StabiFlow may adapt an AI-generated WhatsApp reply to the customer''s language / conversational style via one extra AI pass, preserving the original meaning, amounts, names, links, dates and reference numbers exactly. Presentation only - the original semantic reply is the source of truth. Default false - explicit opt-in only.';

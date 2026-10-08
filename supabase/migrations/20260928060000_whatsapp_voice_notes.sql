-- Phase 10 - WhatsApp voice notes + safe transcription.
--
-- A customer voice note stops being an "unsupported" dead-end:
--   webhook receives audio -> stores the ORIGINAL bytes once in the
--   EXISTING private inbox-media bucket -> creates a normal inbound
--   inbox_messages row (message_type 'voice' | 'audio') -> staff can play
--   the original -> IF the workspace opted in AND is within its Inbox AI
--   budget, the same stored audio is transcribed ONCE by the configured
--   OpenAI transcription model -> the transcript becomes usable
--   conversational content for Inbox AI / structured intake.
--
-- The original audio is the source of truth; the transcript is DERIVED
-- data (possibly inexact) and never overwrites it. No new bucket, no new
-- table, no new domain event (the existing message.received already fires
-- with kind='voice'|'audio'), no job queue - transcription is inline in
-- the webhook, exactly like Phase 6 multimodal media.

-- 1. workspace_settings: the single opt-in ------------------------------
-- Default OFF - a workspace must deliberately allow customer voice-note
-- audio to be sent to the AI provider for transcription. Admin-only via
-- the settings table's existing RLS (update = has_workspace_role(admin)),
-- mirroring ai_multimodal_enabled from Phase 6.

alter table public.workspace_settings
  add column if not exists ai_voice_transcription_enabled boolean not null default false;

comment on column public.workspace_settings.ai_voice_transcription_enabled is
  'Phase 10: when true, StabiFlow may send a customer voice note''s stored audio to the configured AI provider to produce a text transcript for staff and Inbox AI. The original audio is always kept privately regardless. Default false - explicit opt-in only.';

-- 2. inbox_messages: the transcript + honest per-message state ---------
-- Reuses the SAME logical inbound message row (no voice_messages table).
-- transcription_status = null / 'not_requested' both mean "never attempted"
-- (text/image/doc message, pre-Phase-10 row, setting off, human-only with
-- setting off). The transcript column holds the RAW transcript only; the
-- message's `content` keeps its "[Voice note]" placeholder so the UI can
-- always distinguish "Voice note" (authoritative) from "Transcript"
-- (derived, may contain errors).

alter table public.inbox_messages
  add column if not exists transcription_status text
    check (transcription_status in (
      'not_requested', 'pending', 'processed', 'failed', 'too_large', 'unsupported', 'skipped_quota'
    )),
  add column if not exists transcript text,
  add column if not exists transcribed_at timestamptz;

comment on column public.inbox_messages.transcription_status is
  'Phase 10: whether/how a customer voice note was transcribed. not_requested = never attempted; pending = a manual retry is in flight; processed = transcript stored; failed = provider/download error or an empty/near-empty result; too_large = above the transcription size cap; unsupported = an audio MIME the transcription provider cannot read (still stored + playable); skipped_quota = the workspace was over its Inbox AI budget so no provider call was made.';

comment on column public.inbox_messages.transcript is
  'Phase 10: the automatic, possibly-inexact transcript of a customer voice note. Derived data - the original audio in inbox-media is authoritative and is never replaced. Never surfaced as the customer''s verbatim message; the UI labels it "Transcript".';

-- 3. ai_usage_events: transcription is measured in the SAME ledger -----
-- No schema change. Transcription calls write feature =
-- 'whatsapp_voice_transcription' (distinct from 'whatsapp_inbox_ai' so
-- cost analytics can separate them), and BOTH features count toward the
-- one per-workspace monthly Inbox AI allowance (Phase 7) - transcription
-- never gets a second, uncapped budget.

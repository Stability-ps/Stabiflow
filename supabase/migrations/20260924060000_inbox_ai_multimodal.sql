-- Phase 6 - Multimodal WhatsApp AI + document understanding.
--
-- Customer sends a supported image/PDF -> whatsapp-webhook stores it in the
-- EXISTING inbox-media private bucket (unchanged) -> when the workspace has
-- explicitly opted in AND the configured model supports it, the SAME
-- securely-stored object is handed to the EXISTING Inbox AI (OpenAI
-- Responses API in aiReplyEngine.ts) as an image/file input part, so the AI
-- can read the enquiry and extract schema-defined intake fields.
--
-- This migration is intentionally tiny: one opt-in flag on the EXISTING
-- workspace_settings, two honest per-message status columns on the EXISTING
-- inbox_messages, and one additive automation event. No new media bucket,
-- no new AI settings table, no provider file library, no state machine.

-- 1. workspace_settings: the single opt-in --------------------------------
-- Default OFF - a workspace must deliberately allow customer attachments to
-- be sent to the AI provider. Admin-only via the settings table's existing
-- RLS (select = member, update = has_workspace_role(workspace_id,'admin')).

alter table public.workspace_settings
  add column if not exists ai_multimodal_enabled boolean not null default false;

comment on column public.workspace_settings.ai_multimodal_enabled is
  'Phase 6: when true, StabiFlow may send supported customer-supplied images (jpeg/png/webp) and PDFs to the configured AI provider so the WhatsApp Inbox AI can understand the enquiry and extract intake fields. Default false - explicit opt-in only.';

-- 2. inbox_messages: honest per-message AI-media outcome -----------------
-- Nullable: null / 'not_requested' both mean "the AI was never asked to
-- read this" (text message, pre-Phase-6 row, multimodal disabled, model
-- without vision, conversation under human control). The UI only shows a
-- badge for the meaningful states.

alter table public.inbox_messages
  add column if not exists ai_media_status text
    check (ai_media_status in ('not_requested', 'processed', 'unsupported', 'too_large', 'failed')),
  add column if not exists ai_media_processed_at timestamptz;

comment on column public.inbox_messages.ai_media_status is
  'Phase 6: whether/how the Inbox AI consumed this inbound attachment. not_requested = AI never asked to read it; processed = sent to the model; unsupported = MIME the model cannot read; too_large = above the AI-processing size cap; failed = download/model error (the message is still stored, the AI never claims to have read it).';

-- 3. Automation taxonomy: conversation.document_received ----------------
-- Emitted when a SUPPORTED inbound customer document/image has been stored
-- - it means RECEIVED, not "understood by AI". Lets the existing engine
-- act (notify staff, request review) without the SLA/AI worker hardcoding
-- any action. Additive: every prior value retained (list mirrors the
-- Phase-5 re-add).

alter table public.domain_events drop constraint if exists domain_events_event_type_check;
alter table public.domain_events
  add constraint domain_events_event_type_check check (event_type in (
    'conversation.started', 'message.received', 'conversation.human_takeover',
    'conversation.intake_completed', 'conversation.handoff_sla_overdue',
    'conversation.document_received',
    'lead.created', 'lead.qualified', 'lead.stage_changed', 'lead.idle_timeout',
    'opportunity.created', 'opportunity.stage_changed', 'opportunity.won', 'opportunity.lost',
    'customer.created', 'revenue.recorded',
    'content.published', 'content.publish_failed',
    'campaign.published', 'campaign.paused', 'campaign.performance_changed',
    'attribution.created',
    'flow_ai.analysis_completed'
  ));

alter table public.automations drop constraint if exists automations_trigger_event_type_check;
alter table public.automations
  add constraint automations_trigger_event_type_check check (trigger_event_type in (
    'conversation.started', 'message.received', 'conversation.human_takeover',
    'conversation.intake_completed', 'conversation.handoff_sla_overdue',
    'conversation.document_received',
    'lead.created', 'lead.qualified', 'lead.stage_changed', 'lead.idle_timeout',
    'opportunity.created', 'opportunity.stage_changed', 'opportunity.won', 'opportunity.lost',
    'customer.created', 'revenue.recorded',
    'content.published', 'content.publish_failed',
    'campaign.published', 'campaign.paused', 'campaign.performance_changed',
    'attribution.created',
    'flow_ai.analysis_completed'
  ));

-- 4. ai_usage_events already carries a free-text `feature` column (Phase I,
--    default 'flow_ai_chat'). Phase 6 Inbox AI calls write rows with
--    feature='whatsapp_inbox_ai' - no schema change, the existing
--    manage_billing-gated read policy and workspace scoping apply as-is.

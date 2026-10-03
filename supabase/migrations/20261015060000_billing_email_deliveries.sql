-- Idempotent delivery log for StabiFlow-owned billing emails.
-- Service-role only: RLS is enabled with no client policies.

create table if not exists public.billing_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique check (length(event_key) between 3 and 300),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  recipient_email text not null,
  template_key text not null check (template_key in (
    'payment_success',
    'renewal_success',
    'payment_failed',
    'subscription_cancelled',
    'refund_processed'
  )),
  provider text not null default 'resend',
  provider_message_id text,
  status text not null default 'sending' check (status in ('sending', 'sent')),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.billing_email_deliveries enable row level security;

create index if not exists billing_email_deliveries_workspace_created_idx
  on public.billing_email_deliveries (workspace_id, created_at desc);

comment on table public.billing_email_deliveries is
  'Service-role-only idempotency and audit log for StabiFlow branded billing emails.';

-- Global, read-only StabiFlow WhatsApp template starter library.
-- These are reusable drafts/examples, not Meta-approved provider templates.

create table if not exists public.whatsapp_template_library (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  name text not null,
  industry text not null,
  category text not null check (category in ('UTILITY','MARKETING')),
  use_case text not null,
  language text not null default 'en',
  body text not null,
  variables jsonb not null default '[]'::jsonb check (jsonb_typeof(variables) = 'array'),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_template_library enable row level security;

drop policy if exists whatsapp_template_library_select_authenticated on public.whatsapp_template_library;
create policy whatsapp_template_library_select_authenticated
on public.whatsapp_template_library
for select
to authenticated
using (is_active = true);

grant select on public.whatsapp_template_library to authenticated;
revoke insert, update, delete on public.whatsapp_template_library from anon, authenticated;

create index if not exists whatsapp_template_library_industry_idx
  on public.whatsapp_template_library(industry);
create index if not exists whatsapp_template_library_category_idx
  on public.whatsapp_template_library(category);
create index if not exists whatsapp_template_library_use_case_idx
  on public.whatsapp_template_library(use_case);

with industries(slug, label, sort_order) as (
  values
    ('general','General Business',10),
    ('tax_accounting','Tax & Accounting',20),
    ('automotive','Automotive',30),
    ('property','Property & Real Estate',40),
    ('healthcare','Healthcare',50),
    ('beauty_wellness','Beauty & Wellness',60),
    ('retail','Retail',70),
    ('hospitality','Hospitality',80),
    ('education','Education',90),
    ('construction','Construction',100),
    ('professional_services','Professional Services',110),
    ('logistics','Logistics & Transport',120)
),
intents(use_case, display_name, category, body_template, variables, sort_order) as (
  values
    ('appointment_reminder','Appointment reminder','UTILITY',
      'Hello {{1}}, this is a reminder of your appointment with {{2}} on {{3}} at {{4}}. Reply to this message if you need assistance.',
      '["customer_name","business_name","appointment_date","appointment_time"]'::jsonb,10),
    ('appointment_confirmation','Appointment confirmation','UTILITY',
      'Hello {{1}}, your appointment with {{2}} is confirmed for {{3}} at {{4}}. We look forward to seeing you.',
      '["customer_name","business_name","appointment_date","appointment_time"]'::jsonb,20),
    ('quote_follow_up','Quotation follow-up','UTILITY',
      'Hello {{1}}, {{2}} is following up on quotation {{3}}. Please reply if you have any questions or would like us to proceed.',
      '["customer_name","business_name","quote_reference"]'::jsonb,30),
    ('payment_reminder','Payment reminder','UTILITY',
      'Hello {{1}}, this is a friendly reminder from {{2}} that invoice {{3}} for {{4}} is due on {{5}}. Please let us know if you need a copy of the invoice.',
      '["customer_name","business_name","invoice_number","amount","due_date"]'::jsonb,40),
    ('payment_received','Payment received','UTILITY',
      'Hello {{1}}, thank you. {{2}} has received your payment of {{3}} for reference {{4}}.',
      '["customer_name","business_name","amount","reference"]'::jsonb,50),
    ('service_update','Service update','UTILITY',
      'Hello {{1}}, here is an update from {{2}} regarding {{3}}: {{4}}. Reply here if you need more information.',
      '["customer_name","business_name","service_reference","update"]'::jsonb,60),
    ('document_request','Document request','UTILITY',
      'Hello {{1}}, {{2}} still needs the following document or information to continue with {{3}}: {{4}}. Please send it when convenient.',
      '["customer_name","business_name","service_reference","required_item"]'::jsonb,70),
    ('customer_reactivation','Customer reactivation','MARKETING',
      'Hello {{1}}, it has been a while since we assisted you at {{2}}. If you need help with {{3}}, reply here and our team will assist you.',
      '["customer_name","business_name","service_or_product"]'::jsonb,80),
    ('promotion_offer','Promotion / offer','MARKETING',
      'Hello {{1}}, {{2}} has a special offer on {{3}} until {{4}}. Reply to this message if you would like more details.',
      '["customer_name","business_name","offer","expiry_date"]'::jsonb,90),
    ('feedback_request','Feedback request','UTILITY',
      'Hello {{1}}, thank you for choosing {{2}}. We would appreciate your feedback on {{3}}. Reply with your comments or rating.',
      '["customer_name","business_name","service_or_purchase"]'::jsonb,100)
)
insert into public.whatsapp_template_library
  (template_key, name, industry, category, use_case, language, body, variables, sort_order)
select
  i.slug || '_' || t.use_case,
  i.label || ' - ' || t.display_name,
  i.label,
  t.category,
  t.use_case,
  'en',
  t.body_template,
  t.variables,
  i.sort_order + t.sort_order
from industries i
cross join intents t
on conflict (template_key) do update
set
  name = excluded.name,
  industry = excluded.industry,
  category = excluded.category,
  use_case = excluded.use_case,
  language = excluded.language,
  body = excluded.body,
  variables = excluded.variables,
  is_active = true,
  sort_order = excluded.sort_order,
  updated_at = now();

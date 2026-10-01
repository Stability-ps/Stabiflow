-- Reposition the public catalogue around the full StabiFlow platform.
-- Presentation-only changes: prices, Paystack plan codes and entitlements are untouched.

update public.billing_plans
set
  description = case code
    when 'free' then 'Build your business profile and explore StabiFlow.'
    when 'profile_once' then 'A once-off professional company profile PDF.'
    when 'business' then 'Run your core customer and marketing work from one workspace.'
    when 'growth' then 'For growing teams that want connected marketing, conversations and automation.'
    else description
  end,
  marketing = case code
    when 'free' then '{"features":["Build your business profile","Scan your website","Review and correct your business facts","Preview your profile"],"cta":"Start free"}'::jsonb
    when 'profile_once' then '{"features":["Professional A4 company profile PDF","No watermark","Premium designs"],"cta":"Buy once"}'::jsonb
    when 'business' then '{"features":["Everything in Professional Profile","Leads & CRM","Customer management","Content management","Hosted business profile","Website monitoring","More AI credits"],"cta":"Choose Business","badge":"Most popular"}'::jsonb
    when 'growth' then '{"features":["Everything in Business","WhatsApp Business & unified inbox","Meta advertising","Facebook & Instagram integrations","Automation & AI","Advanced analytics","Higher usage limits","More team members"],"cta":"Choose Growth"}'::jsonb
    else marketing
  end,
  updated_at = now()
where code in ('free','profile_once','business','growth');

insert into public.platform_settings (key, value, is_public)
values (
  'content.pricing_intro',
  '{"text":"Start free. Build your business presence, then add the tools you need to market, sell and manage customers."}'::jsonb,
  true
)
on conflict (key) do update
set value = excluded.value, is_public = true, updated_at = now();

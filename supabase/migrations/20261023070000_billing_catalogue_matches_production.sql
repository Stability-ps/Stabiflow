-- Billing catalogue copy: make a fresh database match production.
--
-- Production's plan descriptions and marketing copy were set over several
-- migrations (some applied out of version order, one recovered as
-- 20261002120734) plus Admin edits, and the Automations copy fix
-- (20261022070000). On a fresh database the older repo seed copy remained,
-- e.g. the Free card still promised "Scan your website". This writes the
-- exact current production values for the three plans that differed.
-- Entitlements, prices and definitions already match production.
-- Idempotent: on production it changes nothing.
update public.billing_plans p
set description = v.description, marketing = v.marketing, updated_at = now()
from (values
  ('free', 'Build your core business record and see a protected sample of what Business Studio can create.', '{"cta": "Start free", "features": ["Build your My Business profile", "See a protected Business Studio sample", "Upgrade when you are ready to create the full profile", "Automations require the Growth plan"]}'::jsonb),
  ('growth', 'For growing teams that want connected marketing, conversations and automation.', '{"cta": "Choose Growth", "features": ["Everything in Business", "WhatsApp Business & unified inbox", "Meta advertising", "Facebook & Instagram integrations", "2,000 automation runs / month", "Automation & AI", "Advanced analytics", "Higher usage limits", "More team members"]}'::jsonb),
  ('profile_once', 'A once-off professional company profile PDF from your completed business information.', '{"cta": "Buy profile", "features": ["Professional company profile PDF", "No watermark on the purchased final PDF", "Premium profile designs", "No recurring AI or website-scan allowance", "Automations require the Growth plan"]}'::jsonb)
) as v(code, description, marketing)
where p.code = v.code
  and (p.description is distinct from v.description or p.marketing is distinct from v.marketing);

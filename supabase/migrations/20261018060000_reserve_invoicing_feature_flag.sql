-- Reserve the module.invoicing flag for the upcoming customer invoicing /
-- quotes module (a dedicated future branch - see the UI redesign that adds
-- the Business > Invoices / Business > Quotes nav entries and matching
-- dashboard widget ids behind this flag).
--
-- is_enabled = false is the kill-switch row in evaluate_feature_flags: it
-- is checked FIRST and forces the flag OFF for every workspace, including
-- platform operators. Nothing reads or writes invoice data yet; this row
-- only lets the client-side nav/widget config reference a real flag key
-- instead of inventing a second gating mechanism.
insert into public.feature_flags (key, name, description, category, is_enabled, audience, plan_codes, rollout_percentage)
values (
  'module.invoicing',
  'Invoicing & Quotes',
  'Customer invoicing and quotes. Reserved - not yet implemented.',
  'module',
  false,
  'targeted',
  '{}',
  0
)
on conflict (key) do nothing;

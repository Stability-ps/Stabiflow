-- Recovered from production (supabase_migrations.schema_migrations,
-- version 20261002120734); applied directly to production, never committed.
--
-- Production applied the billing migrations in a different order than
-- their file versions sort in this repo, so on a fresh database this file
-- runs before the billing tables exist. It is a no-op there;
-- 20261023070000_billing_catalogue_matches_production.sql applies the same
-- (and later) catalogue state once the tables exist.
--
-- Business Studio commercial boundary:
-- Free keeps My Business and a protected Studio teaser only.
-- One-off purchases unlock final PDF/premium design only.
-- Recurring Business/Growth subscriptions own scan + AI allowances.
do $$
begin
  if to_regclass('public.plan_entitlements') is null or to_regclass('public.billing_plans') is null then
    return;
  end if;

  delete from public.plan_entitlements pe
  using public.billing_plans p
  where pe.plan_id = p.id
    and p.code = 'free'
    and pe.entitlement_key in ('business_studio.access','business_profile.documents','website_scans','ai_credits');

  delete from public.plan_entitlements pe
  using public.billing_plans p
  where pe.plan_id = p.id
    and p.code = 'profile_once'
    and pe.entitlement_key = 'ai_credits';

  update public.billing_plans
  set
    description = 'Build your core business record and see a protected sample of what Business Studio can create.',
    marketing = jsonb_build_object(
      'features', jsonb_build_array(
        'Build your My Business profile',
        'See a protected Business Studio sample',
        'Upgrade when you are ready to create the full profile'
      ),
      'cta', 'Start free'
    )
  where code = 'free';

  update public.billing_plans
  set
    description = 'A once-off professional company profile PDF from your completed business information.',
    marketing = jsonb_build_object(
      'features', jsonb_build_array(
        'Professional company profile PDF',
        'No watermark on the purchased final PDF',
        'Premium profile designs',
        'No recurring AI or website-scan allowance'
      ),
      'cta', 'Buy profile'
    )
  where code = 'profile_once';
end
$$;

notify pgrst, 'reload schema';

// I/O layer that resolves everything checkCampaignReadiness() (a pure
// function - see adReadiness.ts) needs to judge. Kept separate from the
// pure module on purpose: this is the only place database access happens
// for a readiness check, so it's easy to see exactly what's fetched and
// with which client (always the caller's own RLS-scoped client - a
// readiness check never needs the service role).
import type { ReadinessInput } from "./adReadiness.ts";

// deno-lint-ignore no-explicit-any
export type AnySupabaseClient = any;

export const CAMPAIGN_COLUMNS =
  "id, workspace_id, integration_id, ad_account_id, facebook_page_id, instagram_account_id, name, objective, buying_type, destination_type, status, provider_configured_status, provider_effective_status, external_campaign_id, budget_type, daily_budget_minor_units, lifetime_budget_minor_units, currency, start_at, end_at, audience, placements, draft_creative_id, source_content_media_asset_id, source_content_series_id, provider_state, last_publish_error, created_at, updated_at";

export async function loadReadinessInput(sb: AnySupabaseClient, campaign: Record<string, unknown>): Promise<ReadinessInput> {
  const [
    { data: integration },
    { data: adAccount },
    { data: facebookPage },
    { data: instagramAccount },
    { data: creativeRow },
  ] = await Promise.all([
    campaign.integration_id ? sb.from("workspace_integrations").select("status").eq("id", campaign.integration_id).maybeSingle() : Promise.resolve({ data: null }),
    campaign.ad_account_id ? sb.from("workspace_meta_ad_accounts").select("is_active, currency").eq("id", campaign.ad_account_id).maybeSingle() : Promise.resolve({ data: null }),
    campaign.facebook_page_id ? sb.from("workspace_facebook_pages").select("is_active").eq("id", campaign.facebook_page_id).maybeSingle() : Promise.resolve({ data: null }),
    campaign.instagram_account_id ? sb.from("workspace_instagram_accounts").select("is_active").eq("id", campaign.instagram_account_id).maybeSingle() : Promise.resolve({ data: null }),
    campaign.draft_creative_id
      ? sb.from("ad_creatives").select("primary_text, cta, destination_url, media_asset_id, platform_variant_id, whatsapp_number_id").eq("id", campaign.draft_creative_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const { data: whatsappNumber } = creativeRow?.whatsapp_number_id
    ? await sb.from("workspace_whatsapp_numbers").select("is_active").eq("id", creativeRow.whatsapp_number_id).maybeSingle()
    : { data: null };

  let mediaWidthPx: number | null = null;
  let mediaHeightPx: number | null = null;
  let mediaMimeType: string | null = null;
  if (creativeRow) {
    const { data: media } = creativeRow.platform_variant_id
      ? await sb.from("content_platform_variants").select("width_px, height_px, mime_type").eq("id", creativeRow.platform_variant_id).maybeSingle()
      : await sb.from("content_media_assets").select("width_px, height_px, mime_type").eq("id", creativeRow.media_asset_id).maybeSingle();
    if (media) {
      mediaWidthPx = media.width_px;
      mediaHeightPx = media.height_px;
      mediaMimeType = media.mime_type;
    }
  }

  return {
    campaign: {
      name: campaign.name as string,
      objective: campaign.objective as string,
      destinationType: campaign.destination_type as string,
      budgetType: campaign.budget_type as "daily" | "lifetime",
      dailyBudgetMinorUnits: (campaign.daily_budget_minor_units as number) ?? null,
      lifetimeBudgetMinorUnits: (campaign.lifetime_budget_minor_units as number) ?? null,
      currency: campaign.currency as string,
      startAt: campaign.start_at as string,
      endAt: (campaign.end_at as string) ?? null,
      draftCreativeId: (campaign.draft_creative_id as string) ?? null,
      facebookPageId: (campaign.facebook_page_id as string) ?? null,
      instagramAccountId: (campaign.instagram_account_id as string) ?? null,
    },
    integration: integration ? { status: integration.status } : null,
    adAccount: adAccount ? { isActive: adAccount.is_active, currency: adAccount.currency } : null,
    facebookPage: facebookPage ? { isActive: facebookPage.is_active } : null,
    instagramAccount: instagramAccount ? { isActive: instagramAccount.is_active } : null,
    creative: creativeRow
      ? {
          primaryText: creativeRow.primary_text,
          cta: creativeRow.cta,
          destinationUrl: creativeRow.destination_url,
          mediaWidthPx,
          mediaHeightPx,
          mediaMimeType,
          whatsappNumberId: creativeRow.whatsapp_number_id ?? null,
        }
      : null,
    whatsappNumber: whatsappNumber ? { isActive: whatsappNumber.is_active } : null,
    tokenHealthy: null,
  };
}

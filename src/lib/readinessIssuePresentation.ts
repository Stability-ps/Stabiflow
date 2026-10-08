// Makes server-side readiness issues (ad-campaigns-readiness /
// ad-campaigns-publish) actionable in the Campaign Builder's Publish step.
//
// This is presentation-only: it never changes what counts as ready (that
// stays entirely server-side in supabase/functions/_shared/adReadiness.ts)
// and never invents a second validation system - it just derives, from the
// same issue the server already returns, which builder step/field it maps
// to and a cleaner sentence to show, reusing the SAME field ids the
// client-side validator (campaignBuilderValidation.ts) already renders
// FieldError against.
import type { ReadinessIssue } from "@/lib/adCampaigns";
import type { CampaignBuilderStep } from "@/components/campaigns/campaignBuilderValidation";

export type ReadinessIssuePresentation = {
  message: string;
  severity: ReadinessIssue["severity"];
  step: CampaignBuilderStep | null;
  field: string | null;
};

// Backend issue.message strings are plain lowercase sentences meant for
// logs/other backend consumers, not directly for UI - "start date must not
// be in the past" rather than "Start date must not be in the past."
export function humanizeReadinessMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return trimmed;
  const capitalized = trimmed[0].toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

const CODE_TARGET: Record<string, { step: CampaignBuilderStep; field: string | null }> = {
  missing_name: { step: "Goal", field: "name" },
  unsupported_objective: { step: "Goal", field: "objective" },
  invalid_destination_for_objective: { step: "Ad Account", field: "destinationType" },
  missing_integration: { step: "Ad Account", field: "integration" },
  integration_not_connected: { step: "Ad Account", field: "integration" },
  missing_ad_account: { step: "Ad Account", field: "adAccountId" },
  ad_account_inactive: { step: "Ad Account", field: "adAccountId" },
  currency_mismatch: { step: "Ad Account", field: "adAccountId" },
  missing_page_or_instagram: { step: "Ad Account", field: "pageOrInstagram" },
  facebook_page_inactive: { step: "Ad Account", field: "facebookPageId" },
  instagram_account_inactive: { step: "Ad Account", field: "instagramAccountId" },
  missing_creative: { step: "Creative", field: "mediaAssetId" },
  missing_creative_text: { step: "Creative", field: "primaryText" },
  missing_cta: { step: "Creative", field: "cta" },
  cta_not_allowed_for_objective: { step: "Creative", field: "cta" },
  missing_destination_url: { step: "Creative", field: "destinationUrl" },
  missing_whatsapp_number: { step: "Creative", field: "whatsappNumberId" },
  whatsapp_number_inactive: { step: "Creative", field: "whatsappNumberId" },
  unsupported_creative_media_type: { step: "Creative", field: "mediaAssetId" },
  creative_media_too_small: { step: "Creative", field: "mediaAssetId" },
  // token_unhealthy has no in-builder fix (it requires reconnecting in
  // Integrations) - deliberately left unmapped so no Edit button is shown.
};

// invalid_budget covers several distinct problems (see adMoney.ts) all
// under one code - the message text is the only thing that distinguishes
// which field is actually at fault.
function targetForInvalidBudget(message: string): { step: CampaignBuilderStep; field: string | null } {
  const lower = message.toLowerCase();
  // Order matters: "end time must be after the start time" mentions both.
  if (lower.includes("end date") || lower.includes("end time")) return { step: "Budget & Schedule", field: "endAt" };
  if (lower.includes("start date") || lower.includes("start time")) return { step: "Budget & Schedule", field: "startAt" };
  return { step: "Budget & Schedule", field: "budgetDecimal" };
}

export function presentReadinessIssue(issue: ReadinessIssue): ReadinessIssuePresentation {
  const target = issue.code === "invalid_budget" ? targetForInvalidBudget(issue.message) : CODE_TARGET[issue.code] ?? null;
  return {
    message: humanizeReadinessMessage(issue.message),
    severity: issue.severity,
    step: target?.step ?? null,
    field: target?.field ?? null,
  };
}

// Human "Edit <thing>" labels per builder step, for the correction button
// shown next to a readiness issue on Campaign Detail. The builder step
// names are internal ("Budget & Schedule"); these are what a user sees.
export const READINESS_STEP_ACTION_LABEL: Record<CampaignBuilderStep, string> = {
  "Goal": "Edit goal",
  "Ad Account": "Edit ad account & destination",
  "Audience": "Edit audience",
  "Budget & Schedule": "Edit budget & schedule",
  "Creative": "Edit creative",
  "Review": "Edit campaign",
  "Publish": "Edit campaign",
};

// Special-case: a start/end-date issue reads more naturally as "Edit
// schedule" even though it maps to the "Budget & Schedule" step (spec 3).
export function readinessActionLabel(presentation: ReadinessIssuePresentation): string | null {
  if (!presentation.step) return null;
  if (presentation.step === "Budget & Schedule" && (presentation.field === "startAt" || presentation.field === "endAt")) {
    return "Edit schedule";
  }
  return READINESS_STEP_ACTION_LABEL[presentation.step];
}

// The canonical editor deep-link. The Campaign Builder reads ?step= and
// ?focus= on mount to open at the right step and focus the exact field -
// the SAME step names and field keys the in-builder "Edit <Step>" buttons
// already use (campaignBuilderFieldFocus.ts), not a second system.
export function campaignEditorPath(campaignId: string, step?: CampaignBuilderStep | null, field?: string | null): string {
  const params = new URLSearchParams();
  if (step) params.set("step", step);
  if (field) params.set("focus", field);
  const query = params.toString();
  return `/app/campaigns/${campaignId}/edit${query ? `?${query}` : ""}`;
}

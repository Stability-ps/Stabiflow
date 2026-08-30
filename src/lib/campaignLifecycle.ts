// Single source of truth for how a campaign's lifecycle/readiness is
// PRESENTED on the Campaigns list and Campaign Detail. Both surfaces call
// deriveCampaignPresentation() so they can never disagree (the production
// bug: list/detail badge said "ready" while server readiness said the
// campaign could not be published).
//
// This is presentation-only. It does not change backend meaning: the
// authoritative lifecycle anchor stays `ad_campaigns.status` (the
// ad_lifecycle_status enum) and what counts as publish-ready stays
// entirely server-side (supabase/functions/_shared/adReadiness.ts). This
// module only decides which human label to show, deriving "Ready to
// publish" vs "Needs attention" from an ACTUAL readiness result rather
// than from the stored status alone.
import type { ReadinessIssue } from "@/lib/adCampaigns";

export type CampaignPresentationState =
  | "draft"
  | "needs_attention"
  | "ready_to_publish"
  | "publishing"
  | "active"
  | "paused"
  | "completed"
  | "failed";

// The persisted readiness snapshot ad-campaigns-readiness writes to
// ad_campaigns.last_readiness_check on every check. The list uses this
// (it can't run one readiness edge call per row); Detail/Builder pass a
// fresh `live` result which always wins.
export type ReadinessSnapshot = {
  checked_at?: string;
  ready: boolean;
  issues: ReadinessIssue[];
};

export type CampaignPresentationInput = {
  status: string;
  externalCampaignId?: string | null;
  // Persisted snapshot from ad_campaigns.last_readiness_check (may be null
  // when the campaign has never been checked).
  lastReadinessCheck?: ReadinessSnapshot | null;
  // A just-computed readiness result (Detail page / Builder). Overrides
  // the persisted snapshot when present.
  liveReadiness?: { ready: boolean; issues: ReadinessIssue[] } | null;
};

// draft + ready are both "not yet sent to Meta". `ready` is the stored
// enum value the builder used to set optimistically - we no longer trust
// it on its own, but a row can still carry it in production.
const UNPUBLISHED_STATUSES = new Set(["draft", "ready"]);

/** A campaign that has never been published to Meta and is still fully editable as a local draft. */
export function isUnpublishedCampaign(input: { status: string; external_campaign_id?: string | null }): boolean {
  return !input.external_campaign_id && UNPUBLISHED_STATUSES.has(input.status);
}

/** Only unpublished campaigns can be opened in the Campaign Builder editor. */
export function isEditableCampaign(input: { status: string; external_campaign_id?: string | null }): boolean {
  return isUnpublishedCampaign(input);
}

/**
 * "Delete draft" must never be offered for a campaign that has been
 * published to Meta (see spec 9). Local unpublished drafts only.
 */
export function canDeleteCampaignDraft(input: { status: string; external_campaign_id?: string | null }): boolean {
  return isUnpublishedCampaign(input);
}

export function deriveCampaignPresentation(input: CampaignPresentationInput): CampaignPresentationState {
  switch (input.status) {
    case "publishing":
      return "publishing";
    case "active":
      return "active";
    case "paused":
      return "paused";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      break;
  }

  // Unpublished (draft / stale "ready"). "Ready to publish" is shown ONLY
  // when an actual readiness result says so - never merely because the
  // stored status is "ready".
  const readiness = input.liveReadiness ?? input.lastReadinessCheck ?? null;
  if (!readiness) return "draft";
  return readiness.ready ? "ready_to_publish" : "needs_attention";
}

export type PresentationMeta = {
  label: string;
  // tone drives the badge colour; kept as a small vocabulary rather than
  // raw classes so callers style consistently.
  tone: "neutral" | "info" | "warning" | "success" | "danger";
};

export const CAMPAIGN_PRESENTATION_META: Record<CampaignPresentationState, PresentationMeta> = {
  draft: { label: "Draft", tone: "neutral" },
  needs_attention: { label: "Needs attention", tone: "warning" },
  ready_to_publish: { label: "Ready to publish", tone: "info" },
  publishing: { label: "Publishing", tone: "info" },
  active: { label: "Active", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  completed: { label: "Completed", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
};

export const PRESENTATION_TONE_CLASS: Record<PresentationMeta["tone"], string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  danger: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

import { StatusPill } from "@/components/ui/status-pill";
import { CAMPAIGN_PRESENTATION_META, type CampaignPresentationState } from "@/lib/campaignLifecycle";

// The ONE badge for a campaign's lifecycle/readiness presentation, shared
// by the Campaigns list and Campaign Detail so they can never disagree.
// The caller derives `state` via deriveCampaignPresentation() - this
// component only renders it.
export function CampaignLifecycleBadge({ state, className }: { state: CampaignPresentationState; className?: string }) {
  const meta = CAMPAIGN_PRESENTATION_META[state];
  return <StatusPill tone={meta.tone} className={className}>{meta.label}</StatusPill>;
}

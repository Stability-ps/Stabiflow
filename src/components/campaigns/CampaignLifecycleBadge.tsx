import { Badge } from "@/components/ui/badge";
import {
  CAMPAIGN_PRESENTATION_META,
  PRESENTATION_TONE_CLASS,
  type CampaignPresentationState,
} from "@/lib/campaignLifecycle";

// The ONE badge for a campaign's lifecycle/readiness presentation, shared
// by the Campaigns list and Campaign Detail so they can never disagree.
// The caller derives `state` via deriveCampaignPresentation() - this
// component only renders it.
export function CampaignLifecycleBadge({ state, className }: { state: CampaignPresentationState; className?: string }) {
  const meta = CAMPAIGN_PRESENTATION_META[state];
  return (
    <Badge variant="secondary" className={`${PRESENTATION_TONE_CLASS[meta.tone]} ${className ?? ""}`.trim()}>
      {meta.label}
    </Badge>
  );
}

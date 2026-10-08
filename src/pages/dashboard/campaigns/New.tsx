import { useLocation } from "react-router-dom";
import { CampaignBuilder, type CampaignBuilderPrefill } from "@/components/campaigns/CampaignBuilder";
import { BackLink } from "./BackLink";

export default function NewCampaign() {
  const location = useLocation();
  const prefill = (location.state as { prefill?: CampaignBuilderPrefill } | null)?.prefill;

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-5">
      <div className="space-y-3">
        <BackLink to="/app/campaigns">Campaigns</BackLink>
        <header>
          <h1 className="text-title-page text-foreground">New campaign</h1>
          <p className="mt-1 text-sm text-muted-foreground">Nothing is sent to Meta until you explicitly publish.</p>
        </header>
      </div>
      <CampaignBuilder prefill={prefill} />
    </div>
  );
}

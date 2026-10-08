import { useParams } from "react-router-dom";
import { CampaignBuilder } from "@/components/campaigns/CampaignBuilder";
import { BackLink } from "./BackLink";

export default function EditCampaign() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-5">
      <div className="space-y-3">
        <BackLink to={`/app/campaigns/${id}`}>Campaign</BackLink>
        <header>
          <h1 className="text-title-page text-foreground">Edit draft campaign</h1>
          <p className="mt-1 text-sm text-muted-foreground">Nothing is sent to Meta until you explicitly publish.</p>
        </header>
      </div>
      <CampaignBuilder campaignId={id} />
    </div>
  );
}

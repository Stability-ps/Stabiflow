import { useParams } from "react-router-dom";
import { CampaignDetail } from "@/components/campaigns/CampaignDetail";
import { BackLink } from "./BackLink";

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-3">
      <BackLink to="/app/campaigns">Campaigns</BackLink>
      <CampaignDetail campaignId={id} />
    </div>
  );
}

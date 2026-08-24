import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CampaignDetail } from "@/components/campaigns/CampaignDetail";

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  if (!id) return null;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/campaigns")}><ArrowLeft className="mr-2 h-4 w-4" /> Campaigns</Button>
      <CampaignDetail campaignId={id} />
    </div>
  );
}

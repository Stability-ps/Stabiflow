import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CampaignBuilder } from "@/components/campaigns/CampaignBuilder";

export default function EditCampaign() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  if (!id) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/campaigns/${id}`)}><ArrowLeft className="mr-2 h-4 w-4" /> Campaign</Button>
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit draft campaign</h1>
        <p className="text-sm text-muted-foreground">Nothing is sent to Meta until you explicitly publish.</p>
      </div>
      <CampaignBuilder campaignId={id} />
    </div>
  );
}

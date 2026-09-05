import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CampaignBuilder, type CampaignBuilderPrefill } from "@/components/campaigns/CampaignBuilder";

export default function NewCampaign() {
  const navigate = useNavigate();
  const location = useLocation();
  const prefill = (location.state as { prefill?: CampaignBuilderPrefill } | null)?.prefill;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/app/campaigns")}><ArrowLeft className="mr-2 h-4 w-4" /> Campaigns</Button>
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New campaign</h1>
        <p className="text-sm text-muted-foreground">Nothing is sent to Meta until you explicitly publish.</p>
      </div>
      <CampaignBuilder prefill={prefill} />
    </div>
  );
}

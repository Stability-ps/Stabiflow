import { CampaignsList } from "@/components/campaigns/CampaignsList";

export default function Campaigns() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
        <p className="text-sm text-muted-foreground">Meta advertising campaigns, creatives, and performance.</p>
      </div>
      <CampaignsList />
    </div>
  );
}

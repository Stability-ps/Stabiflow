import { CampaignsList } from "@/components/campaigns/CampaignsList";

export default function Campaigns() {
  return (
    <div className="operational-page space-y-4">
      <div className="operational-header">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Campaign workspace</p>
        <h1 className="operational-title">Campaigns</h1>
        <p className="text-sm text-muted-foreground">Meta advertising campaigns, creatives, and performance.</p>
      </div>
      <CampaignsList />
    </div>
  );
}

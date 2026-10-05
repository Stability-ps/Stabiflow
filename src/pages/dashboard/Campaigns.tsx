import { CampaignsList } from "@/components/campaigns/CampaignsList";

export default function Campaigns() {
  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <div className="rounded-3xl border border-rose-100/80 bg-gradient-to-br from-white via-white to-rose-50/50 p-5 shadow-[0_18px_60px_-44px_hsl(345_55%_40%/0.22)] sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Campaign workspace</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Campaigns</h1>
        <p className="text-sm text-muted-foreground">Meta advertising campaigns, creatives, and performance.</p>
      </div>
      <CampaignsList />
    </div>
  );
}

import { useNavigate } from "react-router-dom";
import { Megaphone, Plug, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { CampaignStatusBadge } from "@/components/campaigns/CampaignStatusBadge";
import { getObjectiveOption } from "@/lib/adObjectives";
import { formatMoney } from "@/lib/adMoney";
import { useAuth } from "@/hooks/useAuth";
import { useAdCampaigns } from "@/hooks/useAdCampaigns";
import { useMetaAdAccounts } from "@/hooks/useMetaAccountResources";

export function CampaignsList() {
  const { currentWorkspaceId, hasPermission } = useAuth();
  const navigate = useNavigate();
  const { data: campaigns, isLoading } = useAdCampaigns(currentWorkspaceId);
  const { data: adAccounts, isLoading: adAccountsLoading } = useMetaAdAccounts(currentWorkspaceId);

  if (isLoading || adAccountsLoading) {
    return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />)}</div>;
  }

  if (!adAccounts?.length) {
    return (
      <EmptyState
        icon={Plug}
        title="No Meta Ad Account connected"
        description="Connect your Meta account in Integrations before creating a campaign."
        action={<Button variant="outline" onClick={() => navigate("/app/integrations")}>Go to Integrations</Button>}
      />
    );
  }

  if (!campaigns?.length) {
    return (
      <EmptyState
        icon={Megaphone}
        title="No campaigns yet"
        description="Create your first Meta campaign."
        action={hasPermission("campaign.create") ? <Button onClick={() => navigate("/app/campaigns/new")}><Plus className="mr-2 h-4 w-4" /> New Campaign</Button> : undefined}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        {hasPermission("campaign.create") && (
          <Button onClick={() => navigate("/app/campaigns/new")}><Plus className="mr-2 h-4 w-4" /> New Campaign</Button>
        )}
      </div>
      <div className="space-y-2">
        {campaigns.map((c) => {
          const objective = getObjectiveOption(c.objective);
          const budget = c.budget_type === "daily" ? c.daily_budget_minor_units : c.lifetime_budget_minor_units;
          return (
            <Card key={c.id} className="flex cursor-pointer items-center gap-4 p-4 hover:bg-accent/40" onClick={() => navigate(`/app/campaigns/${c.id}`)}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <CampaignStatusBadge status={c.status} />
                  <span className="truncate text-sm font-medium">{c.name}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {objective?.label || c.objective} · {c.workspace_meta_ad_accounts?.name || c.workspace_meta_ad_accounts?.ad_account_id || "Ad account"}
                </p>
              </div>
              <div className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">
                <p>{formatMoney(budget, c.currency)} <span className="capitalize">{c.budget_type}</span></p>
                <p>
                  {new Date(c.start_at).toLocaleDateString()}
                  {c.end_at ? ` - ${new Date(c.end_at).toLocaleDateString()}` : " - ongoing"}
                </p>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

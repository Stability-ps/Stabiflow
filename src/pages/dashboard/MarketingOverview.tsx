import { FileText, Megaphone, Palette } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { useMarketingSectionCounts } from "@/hooks/useSectionCounts";
import { SectionLandingHeader, SectionLinkCard } from "@/components/layout/SectionLandingPage";
import { EmptyState } from "@/components/EmptyState";

export default function MarketingOverview() {
  const { currentWorkspaceId } = useAuth();
  const { isEnabled, isLoading } = useFeatureFlags();
  const showContent = isEnabled("module.content");
  const showCampaigns = isEnabled("module.campaigns");
  const showCreativeStudio = isEnabled("module.creative_studio");
  const counts = useMarketingSectionCounts(currentWorkspaceId, { content: showContent, campaigns: showCampaigns, creativeStudio: showCreativeStudio });
  const hasAnyModule = showContent || showCampaigns || showCreativeStudio;

  return (
    <div className="space-y-6">
      <SectionLandingHeader title="Marketing" description="Content, campaigns and creative in one place." />
      {!isLoading && !hasAnyModule ? (
        <EmptyState
          icon={Megaphone}
          title="No marketing tools enabled yet"
          description="Content, Campaigns and Creative Studio aren't enabled for this workspace yet."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {showContent && (
            <SectionLinkCard icon={FileText} title="Content" description="Plan, schedule and publish posts." to="/app/content" count={counts.data?.posts} countLabel="scheduled" />
          )}
          {showCampaigns && (
            <SectionLinkCard icon={Megaphone} title="Campaigns" description="Meta ad campaigns and their performance." to="/app/campaigns" count={counts.data?.campaigns} countLabel="campaigns" />
          )}
          {showCreativeStudio && (
            <SectionLinkCard icon={Palette} title="Creative Studio" description="Generate ad creative from your brand and products." to="/app/creative-studio" count={counts.data?.creatives} countLabel="batches" />
          )}
        </div>
      )}
    </div>
  );
}

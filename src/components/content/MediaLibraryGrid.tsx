import { useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Megaphone, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/EmptyState";
import { MediaPreview } from "@/components/content/MediaPreview";
import { useAuth } from "@/hooks/useAuth";
import { useContentMediaAssets } from "@/hooks/useContentMediaAssets";
import { archiveContentMediaAsset } from "@/lib/contentMediaAssets";
import { generateContentPlatformVariants } from "@/lib/contentFunctions";
import { ImageIcon } from "lucide-react";

type MediaAssetRow = {
  id: string;
  title: string;
  storage_path: string;
  width_px: number;
  height_px: number;
  default_caption: string | null;
  content_platform_variants: { id: string; platform: string }[];
};

export function MediaLibraryGrid({ onSelect, selectable }: { onSelect?: (asset: MediaAssetRow) => void; selectable?: boolean }) {
  const { currentWorkspaceId, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: assets, isLoading, isError } = useContentMediaAssets(currentWorkspaceId);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["content-media-assets", currentWorkspaceId] });

  const handleArchive = async (assetId: string) => {
    try {
      await archiveContentMediaAsset(assetId);
      await invalidate();
      toast.success("Media archived");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to archive");
    }
  };

  const handleGenerateVariants = async (assetId: string) => {
    if (!currentWorkspaceId) return;
    setGeneratingId(assetId);
    try {
      const result = await generateContentPlatformVariants(currentWorkspaceId, assetId);
      const generated = result.results.filter((r) => r.status === "generated").length;
      const needsAdjustment = result.results.filter((r) => r.status === "needs_manual_adjustment");
      if (generated) toast.success(`Generated ${generated} platform variant${generated === 1 ? "" : "s"}`);
      if (needsAdjustment.length) toast.warning(`${needsAdjustment.length} platform${needsAdjustment.length === 1 ? "" : "s"} need manual adjustment - the image shape is too different to auto-convert safely`);
      if (!generated && !needsAdjustment.length) toast.info("This image already meets every platform's requirements");
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to generate variants");
    } finally {
      setGeneratingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-square animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  if (isError) {
    return <EmptyState icon={ImageIcon} title="Couldn't load your Media Library" description="Something went wrong loading media. Try refreshing the page." />;
  }

  if (!assets?.length) {
    return <EmptyState icon={ImageIcon} title="No media yet" description="Upload an image to start building content." />;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {assets.map((asset) => {
        const variants = asset.content_platform_variants || [];
        return (
          <Card key={asset.id} className="overflow-hidden p-0">
            <button
              type="button"
              className="block w-full text-left"
              disabled={!selectable}
              onClick={() => onSelect?.(asset as MediaAssetRow)}
            >
              <MediaPreview storagePath={asset.storage_path} alt={asset.title} className="aspect-[4/3] w-full object-cover" />
            </button>
            <div className="space-y-2 p-3">
              <p className="truncate text-sm font-medium" title={asset.title}>{asset.title}</p>
              <p className="text-xs text-muted-foreground">{asset.width_px}×{asset.height_px}px</p>
              <div className="flex flex-wrap gap-1">
                {variants.length === 0 ? (
                  <Badge variant="outline" className="text-xs font-normal text-muted-foreground">No platform variants yet</Badge>
                ) : (
                  variants.map((v) => (
                    <Badge key={v.id} variant="secondary" className="text-xs font-normal capitalize">{v.platform}</Badge>
                  ))
                )}
              </div>
              {!selectable && hasPermission("media.upload") && (
                <div className="flex gap-1 pt-1">
                  <Button size="sm" variant="outline" className="h-7 flex-1 text-xs" onClick={() => handleGenerateVariants(asset.id)} disabled={generatingId === asset.id}>
                    <Sparkles className="mr-1 h-3 w-3" />
                    {generatingId === asset.id ? "Generating..." : "Variants"}
                  </Button>
                  {hasPermission("media.delete") && (
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleArchive(asset.id)} title="Archive">
                      <Archive className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              )}
              {!selectable && hasPermission("campaign.create") && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-full text-xs"
                  onClick={() =>
                    navigate("/app/campaigns/new", {
                      state: { prefill: { sourceContentMediaAssetId: asset.id, primaryText: asset.default_caption || "" } },
                    })
                  }
                >
                  <Megaphone className="mr-1 h-3 w-3" /> Promote as Campaign
                </Button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

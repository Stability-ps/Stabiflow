import { useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Archive, Megaphone, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { MediaPreview } from "@/components/content/MediaPreview";
import { useAuth } from "@/hooks/useAuth";
import { useContentMediaAssets } from "@/hooks/useContentMediaAssets";
import {
  archiveContentMediaAsset,
  CONTENT_ASSET_ROLE_LABELS,
  updateContentMediaAssetRole,
  type ContentAssetRole,
} from "@/lib/contentMediaAssets";
import { generateContentPlatformVariants } from "@/lib/contentFunctions";
import { ImageIcon } from "lucide-react";

const ROLE_UNCLASSIFIED = "__unclassified__";

type MediaAssetRow = {
  id: string;
  title: string;
  storage_path: string;
  width_px: number;
  height_px: number;
  default_caption: string | null;
  asset_role: ContentAssetRole | null;
  content_platform_variants: { id: string; platform: string }[];
};

export function MediaLibraryGrid({ onSelect, selectable }: { onSelect?: (asset: MediaAssetRow) => void; selectable?: boolean }) {
  const { currentWorkspaceId, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: assets, isLoading, isError, refetch } = useContentMediaAssets(currentWorkspaceId);
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

  const handleRoleChange = async (assetId: string, value: string) => {
    try {
      await updateContentMediaAssetRole(assetId, value === ROLE_UNCLASSIFIED ? null : (value as ContentAssetRole));
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update role");
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" role="status" aria-label="Loading media">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-square animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Couldn't load your Media Library"
        description="Something went wrong loading media. Your files are safe - try again."
        action={<Button variant="outline" onClick={() => void refetch()}>Try again</Button>}
        className="rounded-xl border border-border bg-card"
      />
    );
  }

  if (!assets?.length) {
    return <EmptyState icon={ImageIcon} title="No media yet" description="Upload an image to start building posts and campaigns. StabiFlow creates the Facebook and Instagram sizes for you." className="rounded-xl border border-border bg-card" />;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {assets.map((asset) => {
        const variants = asset.content_platform_variants || [];
        return (
          <div key={asset.id} className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
            {selectable ? (
              <button type="button" className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" onClick={() => onSelect?.(asset as MediaAssetRow)} aria-label={`Select ${asset.title}`}>
                <MediaPreview storagePath={asset.storage_path} alt={asset.title} className="aspect-[4/3] w-full bg-muted object-cover" />
              </button>
            ) : (
              <MediaPreview storagePath={asset.storage_path} alt={asset.title} className="aspect-[4/3] w-full bg-muted object-cover" />
            )}
            <div className="flex flex-1 flex-col gap-2 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground" title={asset.title}>{asset.title}</p>
                <p className="text-xs tabular-nums text-muted-foreground">{asset.width_px}×{asset.height_px}px</p>
              </div>
              {!selectable && hasPermission("media.upload") ? (
                <Select value={asset.asset_role ?? ROLE_UNCLASSIFIED} onValueChange={(v) => handleRoleChange(asset.id, v)}>
                  <SelectTrigger className="h-8 text-xs" aria-label={`Role for ${asset.title}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ROLE_UNCLASSIFIED}>Unclassified</SelectItem>
                    {(Object.entries(CONTENT_ASSET_ROLE_LABELS) as [ContentAssetRole, string][]).map(([role, label]) => (
                      <SelectItem key={role} value={role}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : asset.asset_role ? (
                <StatusPill tone="neutral" dot={false} className="w-fit">{CONTENT_ASSET_ROLE_LABELS[asset.asset_role]}</StatusPill>
              ) : null}
              <div className="flex flex-wrap gap-1" aria-label="Platform variants">
                {variants.length === 0 ? (
                  <span className="text-xs text-muted-foreground">No platform variants yet</span>
                ) : (
                  variants.map((v) => (
                    <StatusPill key={v.id} tone="success" className="capitalize">{v.platform}</StatusPill>
                  ))
                )}
              </div>
              {!selectable && hasPermission("media.upload") && (
                <div className="mt-auto flex gap-1 pt-1">
                  <Button size="sm" variant="outline" className="h-8 flex-1 text-xs" onClick={() => handleGenerateVariants(asset.id)} disabled={generatingId === asset.id}>
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    {generatingId === asset.id ? "Generating..." : "Variants"}
                  </Button>
                  {hasPermission("media.delete") && (
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleArchive(asset.id)} title="Archive" aria-label={`Archive ${asset.title}`}>
                      <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              )}
              {!selectable && hasPermission("campaign.create") && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-full text-xs"
                  onClick={() =>
                    navigate("/app/campaigns/new", {
                      state: { prefill: { sourceContentMediaAssetId: asset.id, primaryText: asset.default_caption || "" } },
                    })
                  }
                >
                  <Megaphone className="h-3.5 w-3.5" aria-hidden="true" /> Promote as Campaign
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

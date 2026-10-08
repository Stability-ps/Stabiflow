import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ImagePlus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useSocialDestinations } from "@/hooks/useSocialDestinations";
import { useContentMediaAssets } from "@/hooks/useContentMediaAssets";
import { MediaPreview } from "@/components/content/MediaPreview";
import { platformKeyForContentPlatform, validateAssetForPlatform } from "@/lib/contentPlatformRules";
import { parseLocalDateTimeInZone, toLocalDateTimeInputValue } from "@/lib/contentTimezone";
import { scheduleContentPost, publishContentPostNow, generateContentCaption } from "@/lib/contentFunctions";

type PlatformVariant = { id: string; platform: string; storage_path: string; width_px: number; height_px: number; mime_type: string; file_size_bytes: number };
type MediaAsset = { id: string; title: string; storage_path: string; mime_type: string; width_px: number; height_px: number; file_size_bytes: number; content_platform_variants?: PlatformVariant[] };

export function ComposePostDialog({ open, onOpenChange, workspaceTimezone, initialDate }: { open: boolean; onOpenChange: (open: boolean) => void; workspaceTimezone: string; initialDate?: Date }) {
  const { currentWorkspaceId } = useAuth();
  const queryClient = useQueryClient();
  const { data: destinations } = useSocialDestinations(currentWorkspaceId);
  const { data: assets } = useContentMediaAssets(currentWorkspaceId);

  const [destinationKey, setDestinationKey] = useState<string>(""); // "platform:id"
  const [selectedAssetId, setSelectedAssetId] = useState<string>("");
  const [caption, setCaption] = useState("");
  const [whenMode, setWhenMode] = useState<"now" | "schedule">("schedule");
  const [scheduledAtLocal, setScheduledAtLocal] = useState(() => {
    const base = initialDate ? new Date(initialDate.getFullYear(), initialDate.getMonth(), initialDate.getDate(), 9, 0) : new Date(Date.now() + 60 * 60 * 1000);
    return toLocalDateTimeInputValue(base, workspaceTimezone);
  });
  const [submitting, setSubmitting] = useState(false);
  const [generatingCaption, setGeneratingCaption] = useState(false);
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [tone, setTone] = useState("professional");

  const selectedAsset = (assets as MediaAsset[] | undefined)?.find((a) => a.id === selectedAssetId) ?? null;
  const [platform, destinationId] = destinationKey ? destinationKey.split(":") : [null, null];

  // Mirrors the server's preference exactly (content-schedule-post/index.ts):
  // the original is preferred whenever it already passes on its own; only
  // fall back to an existing generated variant - and only if THAT variant
  // itself validates - when the original doesn't. Checking only the
  // original here would block submission for a post the server would
  // actually accept via its variant fallback, and vice versa this stays
  // UX-only: the server re-validates independently regardless.
  const validation = useMemo(() => {
    if (!selectedAsset || !platform) return null;
    const platformKey = platformKeyForContentPlatform(platform);
    const originalValidation = validateAssetForPlatform(
      { mimeType: selectedAsset.mime_type, width: selectedAsset.width_px, height: selectedAsset.height_px, fileSizeBytes: selectedAsset.file_size_bytes },
      platformKey,
    );
    if (originalValidation.valid) return originalValidation;

    const variant = selectedAsset.content_platform_variants?.find((v) => v.platform === platform);
    if (!variant) return originalValidation;
    const variantValidation = validateAssetForPlatform(
      { mimeType: variant.mime_type, width: variant.width_px, height: variant.height_px, fileSizeBytes: variant.file_size_bytes },
      platformKey,
    );
    return variantValidation.valid ? variantValidation : originalValidation;
  }, [selectedAsset, platform]);

  const reset = () => {
    setDestinationKey("");
    setSelectedAssetId("");
    setCaption("");
    setHashtags([]);
    setTone("professional");
    setWhenMode("schedule");
  };

  const handleGenerateCaption = async () => {
    if (!currentWorkspaceId || !selectedAsset) return;
    setGeneratingCaption(true);
    try {
      const result = await generateContentCaption({
        workspace_id: currentWorkspaceId,
        media_asset_id: selectedAsset.id,
        target_platform: platform === "facebook" || platform === "instagram" ? platform : undefined,
        tone,
      });
      const nextCaption = [result.suggestion.caption, result.suggestion.cta].filter(Boolean).join("\n\n");
      setCaption(nextCaption);
      setHashtags(result.suggestion.hashtags);
      toast.success("AI caption ready - review it before scheduling");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to generate caption");
    } finally {
      setGeneratingCaption(false);
    }
  };

  const handleSubmit = async () => {
    if (!currentWorkspaceId || !platform || !destinationId || !selectedAsset) return;
    const scheduledAt = whenMode === "now" ? new Date() : parseLocalDateTimeInZone(scheduledAtLocal, workspaceTimezone);
    if (!scheduledAt) {
      toast.error("Choose a valid date and time");
      return;
    }
    setSubmitting(true);
    try {
      const { post } = await scheduleContentPost({
        workspace_id: currentWorkspaceId,
        target_platform: platform as "facebook" | "instagram",
        facebook_page_id: platform === "facebook" ? destinationId : undefined,
        instagram_account_id: platform === "instagram" ? destinationId : undefined,
        media_asset_id: selectedAsset.id,
        caption,
        hashtags,
        scheduled_at: scheduledAt.toISOString(),
      });

      if (whenMode === "now") {
        const result = await publishContentPostNow(post.id);
        if (result.ok) toast.success("Published");
        else toast.warning(`Publish attempt: ${result.outcome.replace(/_/g, " ")} - check Scheduled for status`);
      } else {
        toast.success("Post scheduled");
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["content-scheduled-posts", currentWorkspaceId] }),
      ]);
      reset();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create the post");
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !!(currentWorkspaceId && platform && destinationId && selectedAsset && caption.trim() && (validation?.valid ?? false));

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) reset(); }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New post</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Destination</Label>
            {destinations?.length ? (
              <Select value={destinationKey} onValueChange={setDestinationKey}>
                <SelectTrigger><SelectValue placeholder="Choose where to post" /></SelectTrigger>
                <SelectContent>
                  {destinations.map((d) => (
                    <SelectItem key={`${d.platform}:${d.id}`} value={`${d.platform}:${d.id}`}>
                      <span className="capitalize">{d.platform}</span> · {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                No social accounts connected yet. Connect Facebook or Instagram in Integrations before posting.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Media</Label>
            {selectedAsset ? (
              <div className="flex items-center gap-3 rounded-md border p-2">
                <MediaPreview storagePath={selectedAsset.storage_path} alt={selectedAsset.title} className="h-14 w-14 shrink-0 rounded" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{selectedAsset.title}</p>
                  <p className="text-xs text-muted-foreground">{selectedAsset.width_px}×{selectedAsset.height_px}px</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setSelectedAssetId("")}>Change</Button>
              </div>
            ) : (assets as MediaAsset[] | undefined)?.length ? (
              <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto rounded-md border p-2">
                {(assets as MediaAsset[]).map((asset) => (
                  <button key={asset.id} type="button" onClick={() => setSelectedAssetId(asset.id)} className="rounded outline-none ring-primary focus-visible:ring-2">
                    <MediaPreview storagePath={asset.storage_path} alt={asset.title} className="aspect-square w-full rounded" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                <ImagePlus className="h-4 w-4" /> No media yet - upload something in the Media Library first.
              </p>
            )}
          </div>

          {validation && (
            <div className={`flex items-start gap-2 rounded-lg p-2 text-sm ${validation.valid ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>
              {validation.valid ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
              <div>
                {validation.valid ? (
                  <span>Meets {platform === "facebook" ? "Facebook" : "Instagram"}'s requirements.</span>
                ) : (
                  <div className="space-y-0.5">
                    <p>Doesn't meet requirements yet:</p>
                    <ul className="list-inside list-disc">
                      {validation.failures.map((f, i) => <li key={i}>{f.message}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="caption">Caption</Label>
              <div className="flex items-center gap-2">
                <Select value={tone} onValueChange={setTone}>
                  <SelectTrigger className="h-8 w-[130px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="friendly">Friendly</SelectItem>
                    <SelectItem value="confident">Confident</SelectItem>
                    <SelectItem value="playful">Playful</SelectItem>
                  </SelectContent>
                </Select>
                <Button type="button" size="sm" variant="outline" disabled={!selectedAsset || generatingCaption} onClick={handleGenerateCaption}>
                  <Sparkles className="mr-1 h-4 w-4" /> {generatingCaption ? "Writing..." : "Write with AI"}
                </Button>
              </div>
            </div>
            <Textarea id="caption" rows={5} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder={selectedAsset ? "Write your own caption or let AI use this photo and your business profile..." : "Choose a photo first..."} />
            {hashtags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {hashtags.map((tag) => <button type="button" key={tag} className="rounded-full bg-muted px-2 py-1 text-xs" onClick={() => setHashtags((current) => current.filter((h) => h !== tag))}>#{tag} ×</button>)}
              </div>
            )}
            <p className="text-xs text-muted-foreground">AI uses the selected image together with your My Business profile and services. You stay in control and can edit everything before publishing.</p>
          </div>

          <div className="space-y-1.5">
            <Label>When</Label>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={whenMode === "schedule" ? "default" : "outline"} onClick={() => setWhenMode("schedule")}>Schedule</Button>
              <Button type="button" size="sm" variant={whenMode === "now" ? "default" : "outline"} onClick={() => setWhenMode("now")}>Publish now</Button>
            </div>
            {whenMode === "schedule" && (
              <input
                type="datetime-local"
                value={scheduledAtLocal}
                onChange={(e) => setScheduledAtLocal(e.target.value)}
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!canSubmit || submitting} className="w-full">
            {submitting ? "Saving..." : whenMode === "now" ? "Publish now" : "Schedule post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

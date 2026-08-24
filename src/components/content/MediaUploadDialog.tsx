import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { uploadContentMediaAsset } from "@/lib/contentMediaAssets";
import { MediaPreview } from "@/components/content/MediaPreview";

export function MediaUploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { currentWorkspaceId, user } = useAuth();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [duplicate, setDuplicate] = useState<Record<string, unknown> | null>(null);

  const reset = () => {
    setFile(null);
    setTitle("");
    setCaption("");
    setDuplicate(null);
  };

  const doUpload = async (allowDuplicate: boolean) => {
    if (!file || !currentWorkspaceId || !user) return;
    setSubmitting(true);
    try {
      const result = await uploadContentMediaAsset({
        workspaceId: currentWorkspaceId,
        file,
        title: title.trim() || file.name,
        defaultCaption: caption,
        createdBy: user.id,
        allowDuplicate,
      });
      if (result.kind === "duplicate") {
        setDuplicate(result.existing);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["content-media-assets", currentWorkspaceId] });
      toast.success("Media uploaded");
      reset();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (duplicate) {
    return (
      <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) reset(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>This file is already in your Media Library</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-3">
            <MediaPreview storagePath={String(duplicate.storage_path)} alt={String(duplicate.title)} className="h-16 w-16 shrink-0 rounded-md" />
            <p className="text-sm text-muted-foreground">
              An identical image (<strong>{String(duplicate.title)}</strong>) already exists in this workspace. You can reuse it instead of uploading a duplicate.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => doUpload(true)} disabled={submitting}>
              {submitting ? "Uploading..." : "Upload anyway"}
            </Button>
            <Button onClick={() => { reset(); onOpenChange(false); }}>Use existing asset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) reset(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Upload media</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="file">Image (JPEG or PNG, up to 15MB)</Label>
            <Input id="file" type="file" accept="image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={file?.name || "e.g. Summer sale banner"} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="caption">Default caption (optional)</Label>
            <Input id="caption" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Used when no caption is entered at posting time" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => doUpload(false)} disabled={!file || submitting} className="w-full">
            {submitting ? "Uploading..." : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

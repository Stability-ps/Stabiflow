import { useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MediaLibraryGrid } from "@/components/content/MediaLibraryGrid";
import { MediaUploadDialog } from "@/components/content/MediaUploadDialog";
import { useAuth } from "@/hooks/useAuth";

export default function MediaLibrary() {
  const { hasPermission } = useAuth();
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Media Library</h2>
          <p className="text-sm text-muted-foreground">Original images and their generated Facebook/Instagram variants.</p>
        </div>
        {hasPermission("media.upload") && (
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="mr-2 h-4 w-4" /> Upload
          </Button>
        )}
      </div>
      <MediaLibraryGrid />
      <MediaUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </div>
  );
}

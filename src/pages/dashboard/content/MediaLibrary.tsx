import { useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MediaLibraryGrid } from "@/components/content/MediaLibraryGrid";
import { MediaUploadDialog } from "@/components/content/MediaUploadDialog";
import { SectionHeader } from "./SectionHeader";
import { useAuth } from "@/hooks/useAuth";

export default function MediaLibrary() {
  const { hasPermission } = useAuth();
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Media Library"
        description="Original images and their generated Facebook/Instagram variants."
        action={hasPermission("media.upload") && (
          <Button onClick={() => setUploadOpen(true)}>
            <Upload aria-hidden="true" /> Upload
          </Button>
        )}
      />
      <MediaLibraryGrid />
      <MediaUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </div>
  );
}

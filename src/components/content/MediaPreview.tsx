import { useEffect, useRef, useState } from "react";
import { ImageIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getContentAssetPreviewUrl } from "@/lib/contentMediaAssets";

// Preserves the exact fix Acapolite's Media Library shipped for two real
// production defects:
//  1. Placeholder-thumbnail defect: previews used to only load on click,
//     so a freshly opened library showed a grid of placeholder icons until
//     each card was interacted with. Fixed by eagerly requesting a signed
//     URL for every visible card the moment it mounts (the effect below),
//     not on demand.
//  2. Signed URLs expire (300s) and can occasionally fail transiently -
//     retried exactly once with a fresh signed URL before giving up and
//     showing "Preview unavailable", rather than either retrying forever
//     or giving up on the first hiccup.
export function MediaPreview({ storagePath, alt, className }: { storagePath: string; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const retryCount = useRef(0);

  const load = async (force = false) => {
    if (!force && url) return;
    const signed = await getContentAssetPreviewUrl(storagePath);
    if (signed) {
      setUrl(signed);
      setFailed(false);
    } else {
      setFailed(true);
    }
  };

  useEffect(() => {
    retryCount.current = 0;
    setUrl(null);
    setFailed(false);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storagePath]);

  const handleError = () => {
    if (retryCount.current >= 1) {
      setFailed(true);
      return;
    }
    retryCount.current += 1;
    load(true); // one retry with a freshly-signed URL
  };

  if (failed) {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-1 bg-muted text-muted-foreground", className)}>
        <ImageIcon className="h-6 w-6" />
        <span className="text-xs">Preview unavailable</span>
      </div>
    );
  }

  if (!url) {
    return (
      <div className={cn("flex items-center justify-center bg-muted", className)}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <img src={url} alt={alt} onError={handleError} className={cn("object-cover", className)} />;
}

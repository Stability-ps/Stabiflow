import { useState } from "react";
import { Expand, ImageOff } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { GuideScreenshot as Shot } from "@/content/guide/types";

export const SCREENSHOT_BASE = "/help/screenshots/";

/** A real product screenshot; click/tap opens a larger view. */
export function GuideScreenshot({ shot }: { shot: Shot }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = `${SCREENSHOT_BASE}${shot.src}`;

  if (failed) {
    return (
      <figure className="guide-figure my-5 flex items-center gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        <ImageOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{shot.alt}</span>
      </figure>
    );
  }

  return (
    <figure className={cn("guide-figure my-5", shot.mobile && "max-w-[300px]")}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative block w-full overflow-hidden rounded-xl border bg-muted/30 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Enlarge screenshot: ${shot.alt}`}
      >
        <img src={src} alt={shot.alt} loading="lazy" decoding="async" onError={() => setFailed(true)} className="block h-auto w-full" />
        <span className="guide-no-print absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg bg-background/90 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true">
          <Expand className="h-4 w-4" />
        </span>
      </button>
      {shot.caption && <figcaption className="mt-2 text-center text-xs text-muted-foreground">{shot.caption}</figcaption>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[94dvh] w-[calc(100vw-1.5rem)] max-w-6xl overflow-auto p-3 sm:p-4" data-testid="guide-lightbox">
          <DialogTitle className="sr-only">Screenshot</DialogTitle>
          <DialogDescription className="sr-only">{shot.alt}</DialogDescription>
          <img src={src} alt={shot.alt} className={cn("mx-auto h-auto max-h-[82dvh] w-auto max-w-full rounded-lg object-contain", shot.mobile && "max-w-[420px]")} />
          {(shot.caption || shot.alt) && <p className="mt-2 text-center text-sm text-muted-foreground">{shot.caption ?? shot.alt}</p>}
        </DialogContent>
      </Dialog>
    </figure>
  );
}

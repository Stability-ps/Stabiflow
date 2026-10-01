import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// Mobile-native bottom sheet built on the same Radix Dialog primitive as
// Sheet/Dialog: focus trap, Escape, backdrop-tap-to-close and body scroll
// lock (restored on close) all come from Radix. Pair with
// useOverlayHistory() so the device Back button closes it too.
export const BottomSheet = SheetPrimitive.Root;

type BottomSheetContentProps = React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content> & {
  title: string;
  description?: string;
  /** Visually hide the title (still announced to screen readers). */
  hideTitle?: boolean;
};

export const BottomSheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, BottomSheetContentProps>(
  ({ className, children, title, description, hideTitle, ...props }, ref) => (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        data-testid="bottom-sheet-overlay"
        className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none"
      />
      <SheetPrimitive.Content
        ref={ref}
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl border-t bg-background shadow-2xl outline-none",
          "pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          "data-[state=closed]:duration-200 data-[state=open]:duration-300 motion-reduce:animate-none",
          "sm:inset-x-auto sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2",
          className,
        )}
        {...props}
      >
        <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/25" aria-hidden="true" />
        <div className={cn("flex shrink-0 items-start justify-between gap-3 px-4 pb-2 pt-3", hideTitle && "sr-only")}>
          <div className="min-w-0">
            <SheetPrimitive.Title className="text-base font-semibold leading-6">{title}</SheetPrimitive.Title>
            {description ? <SheetPrimitive.Description className="text-sm text-muted-foreground">{description}</SheetPrimitive.Description> : null}
          </div>
          <SheetPrimitive.Close
            className="-mr-2 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </SheetPrimitive.Close>
        </div>
        {!description ? <SheetPrimitive.Description className="sr-only">{title}</SheetPrimitive.Description> : null}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">{children}</div>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  ),
);
BottomSheetContent.displayName = "BottomSheetContent";

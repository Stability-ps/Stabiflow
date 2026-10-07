import * as React from "react";
import { cn } from "@/lib/utils";

// Figma "Panel" - the single card surface: 12px radius, 1px border, no
// resting shadow. Header row holds a title and at most one quiet action.
// Don't nest a Panel inside a Panel; use dividers or sub-headings instead.
const Panel = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(({ className, ...props }, ref) => (
  <section ref={ref} className={cn("overflow-hidden rounded-xl border border-border bg-card text-card-foreground", className)} {...props} />
));
Panel.displayName = "Panel";

function PanelHeader({ title, action, description, className, titleId }: {
  title: React.ReactNode;
  action?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  titleId?: string;
}) {
  return (
    <div className={cn("flex min-h-12 items-center gap-3 border-b border-border px-4 py-3", className)}>
      <div className="min-w-0 flex-1">
        <h2 id={titleId} className="truncate text-title-card text-foreground">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

const PanelBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-4", className)} {...props} />
));
PanelBody.displayName = "PanelBody";

export { Panel, PanelHeader, PanelBody };

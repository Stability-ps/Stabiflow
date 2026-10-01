import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** A compact empty state sized for a dashboard tile - EmptyState's py-16 is
 * right for a full page section, not a grid cell. */
export function EmptyWidgetState({ icon: Icon, title, description, action }: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center">
      <Icon className="h-5 w-5 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-[22rem] text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

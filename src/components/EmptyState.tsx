import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Figma "Empty State". Every empty state answers: why is this empty, is
// anything wrong, what next - title states the next step, description gives
// the reason, one primary action.
export function EmptyState({ icon: Icon, title, description, action, className }: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className="text-title-section text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";

export function PlaceholderPage({ title, description, icon, emptyTitle, emptyDescription, children }: {
  title: string;
  description: string;
  icon: LucideIcon;
  emptyTitle: string;
  emptyDescription: string;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <EmptyState icon={icon} title={emptyTitle} description={emptyDescription} className="min-h-[50vh]" />
      {children}
    </div>
  );
}

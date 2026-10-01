import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function SectionLandingHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A clickable overview card linking into one module from a section landing
 * page (Business, Marketing). `count` is a cheap, already-fetched number -
 * never render one that required a full row fetch just to display it. */
export function SectionLinkCard({ icon: Icon, title, description, to, count, countLabel, className }: {
  icon: LucideIcon;
  title: string;
  description: string;
  to: string;
  count?: number;
  countLabel?: string;
  className?: string;
}) {
  return (
    <Link to={to} className={cn("block", className)}>
      <Card className="h-full transition-colors hover:border-primary/40 hover:bg-accent/40">
        <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="h-4.5 w-4.5" />
            </span>
            <CardTitle className="text-base">{title}</CardTitle>
          </div>
          {count !== undefined && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {count} {countLabel ?? ""}
            </span>
          )}
        </CardHeader>
        <CardContent>
          <CardDescription>{description}</CardDescription>
        </CardContent>
      </Card>
    </Link>
  );
}

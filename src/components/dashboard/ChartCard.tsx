import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** Shared chrome for every chart/list dashboard widget: title, optional
 * description, a loading skeleton that doesn't jump the layout once data
 * arrives, an inline retry on query failure (not a crash), and the
 * caller's empty-state markup when there's genuinely nothing to show. */
export function ChartCard({ title, description, isLoading, isError, onRetry, isEmpty, emptyState, height = 220, children }: {
  title: string;
  description?: string;
  isLoading: boolean;
  isError?: boolean;
  onRetry?: () => void;
  isEmpty?: boolean;
  emptyState?: ReactNode;
  height?: number;
  children: ReactNode;
}) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="animate-pulse rounded-lg bg-muted" style={{ height }} />
        ) : isError ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center" style={{ minHeight: Math.min(height, 140) }}>
            <AlertTriangle className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{title} unavailable</p>
            {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>}
          </div>
        ) : isEmpty ? (
          emptyState
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

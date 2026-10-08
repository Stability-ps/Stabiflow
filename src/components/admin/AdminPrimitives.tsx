// Reusable admin building blocks: page header, stat tile, section card,
// loading/error/empty states, pagination and a permission gate.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ChevronLeft, ChevronRight, Info, Lock, RefreshCw, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AdminApiError } from "@/lib/adminApi";
import type { AdminPermission } from "@/lib/adminPermissions";
import { useAdmin } from "@/hooks/useAdmin";
import { cn } from "@/lib/utils";

export function AdminPageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Explains how a metric is calculated. */
export function MetricHelp({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="How this is calculated">
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-relaxed">{children}</TooltipContent>
    </Tooltip>
  );
}

export function StatTile({ label, value, sub, help, tone = "default", href }: {
  label: string; value: ReactNode; sub?: ReactNode; help?: ReactNode; tone?: "default" | "warning" | "danger"; href?: string;
}) {
  const body = (
    <div className={cn(
      "h-full rounded-xl border bg-card p-4 transition-colors",
      href && "hover:border-primary/40 hover:bg-accent/40",
      tone === "warning" && "border-amber-300/70 dark:border-amber-500/40",
      tone === "danger" && "border-destructive/50",
    )}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        {help ? <MetricHelp>{help}</MetricHelp> : null}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
  return href ? <Link to={href} className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">{body}</Link> : body;
}

export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4", className)}>{children}</div>;
}

export function Section({ title, description, actions, children, className }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-base">{title}</CardTitle>
          {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function LoadingTiles({ count = 8 }: { count?: number }) {
  return (
    <StatGrid>
      {Array.from({ length: count }, (_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)}
    </StatGrid>
  );
}

export function LoadingRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const forbidden = error instanceof AdminApiError && error.status === 403;
  const ref = error instanceof AdminApiError ? error.ref : null;
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center">
      {forbidden ? <Lock className="h-6 w-6 text-muted-foreground" /> : <AlertCircle className="h-6 w-6 text-destructive" />}
      <p className="text-sm font-medium">{forbidden ? "Your role does not include this data." : "This data could not be loaded."}</p>
      <p className="max-w-md text-xs text-muted-foreground">
        {forbidden ? "Ask the Owner to change your role if you need it." : error instanceof Error && error.message !== "Request failed" ? error.message : "Try again in a moment."}
        {ref ? ` Reference: ${ref}` : ""}
      </p>
      {onRetry && !forbidden ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1"><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Retry</Button>
      ) : null}
    </div>
  );
}

export function EmptyNote({ icon: Icon, children }: { icon?: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-6 text-sm text-muted-foreground justify-center text-center">
      {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
      <span>{children}</span>
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  if (total === 0) return null;
  const first = page * pageSize + 1;
  const last = Math.min((page + 1) * pageSize, total);
  return (
    <div className="flex items-center justify-between gap-2 pt-3 text-xs text-muted-foreground">
      <span>{first.toLocaleString()}–{last.toLocaleString()} of {total.toLocaleString()}</span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
        <span className="px-2">Page {page + 1} of {pages}</span>
        <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

/** Renders children only when the role has the permission; otherwise a clear
 * explanation (the server enforces it regardless). */
export function RequirePermission({ permission, children }: { permission: AdminPermission; children: ReactNode }) {
  const { can } = useAdmin();
  if (can(permission)) return <>{children}</>;
  return <ErrorState error={new AdminApiError("Forbidden", 403, null)} />;
}

export function DataTable({ children, minWidth = 720 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full text-left text-sm" style={{ minWidth }}>{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th scope="col" className={cn("border-b px-2 py-2 text-xs font-medium text-muted-foreground first:pl-0", className)}>{children}</th>;
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("border-b px-2 py-2.5 align-top first:pl-0", className)}>{children}</td>;
}

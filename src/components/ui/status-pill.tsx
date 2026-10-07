import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// Figma "Status Pill" - one status vocabulary across the product. The label
// is mandatory: colour is never the only signal.
//   neutral = draft / paused / archived     success = active / connected / published
//   warning = needs attention / waiting     danger  = failed / error
//   info    = scheduled / in progress       brand   = AI / StabiFlow-driven
export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

const TONE: Record<StatusTone, { pill: string; dot: string }> = {
  neutral: { pill: "bg-muted text-muted-foreground", dot: "bg-subtle-foreground" },
  success: { pill: "bg-success-soft text-success", dot: "bg-success-solid" },
  warning: { pill: "bg-warning-soft text-warning", dot: "bg-warning-solid" },
  danger: { pill: "bg-destructive-soft text-destructive-strong", dot: "bg-destructive" },
  info: { pill: "bg-info-soft text-info", dot: "bg-info-solid" },
  brand: { pill: "bg-brand-soft text-brand", dot: "bg-brand" },
};

export function StatusPill({
  tone = "neutral",
  dot = true,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: StatusTone; dot?: boolean }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", TONE[tone].pill, className)}
      {...props}
    >
      {dot ? <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE[tone].dot)} /> : null}
      {children}
    </span>
  );
}

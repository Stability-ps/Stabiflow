import { BadgeCheck, CircleDashed, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { SOURCE_LABELS, VERIFICATION_LABELS, type FactSource, type VerificationStatus } from "@/lib/businessIdentity";

/** "Found on your website · Not yet confirmed" - where a fact came from and whether it has been checked. */
export function ProvenanceBadge({ source, status, className }: { source?: string | null; status?: string | null; className?: string }) {
  const src = source && source in SOURCE_LABELS ? SOURCE_LABELS[source as FactSource] : null;
  const st = (status && status in VERIFICATION_LABELS ? status : "unverified") as VerificationStatus;
  const Icon = st === "verified" ? ShieldCheck : st === "user_confirmed" ? BadgeCheck : CircleDashed;
  return (
    <p className={cn("flex items-center gap-1 text-xs text-muted-foreground", className)}>
      <Icon className={cn("h-3.5 w-3.5", st === "verified" && "text-emerald-600 dark:text-emerald-300", st === "user_confirmed" && "text-primary")} aria-hidden="true" />
      <span>
        {src ? `${src} · ` : ""}
        {VERIFICATION_LABELS[st]}
      </span>
    </p>
  );
}

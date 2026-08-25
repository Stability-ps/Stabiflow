// Maps the backend's last_health_check_status free-text values (set by
// integrations-oauth-callback / integrations-connection-health /
// integrations-disconnect) to a user-facing label, tone, and remediation
// hint (instruction #8/#24/#39). Client-side presentation only - the
// database is never taught this vocabulary as an enum, see the Phase C
// migration's header comment.
export type IntegrationTone = "healthy" | "attention" | "error" | "neutral";

export type IntegrationStatusPresentation = {
  label: string;
  tone: IntegrationTone;
  remediation: string | null;
};

const STATUS_MAP: Record<string, IntegrationStatusPresentation> = {
  healthy: { label: "Healthy", tone: "healthy", remediation: null },
  needs_attention: { label: "Needs attention", tone: "attention", remediation: "One or more connected resources need attention." },
  reauthorization_required: { label: "Reauthorization required", tone: "error", remediation: "Your authorization has expired. Reconnect to restore access." },
  disconnected: { label: "Disconnected", tone: "neutral", remediation: null },
  error: { label: "Connection error", tone: "error", remediation: "Something went wrong connecting this provider. Try reconnecting." },
};

export function presentIntegrationStatus(status: string | null, connected: boolean): IntegrationStatusPresentation {
  if (!connected) return { label: "Not connected", tone: "neutral", remediation: null };
  if (status && STATUS_MAP[status]) return STATUS_MAP[status];
  return { label: "Connected", tone: "neutral", remediation: null };
}

export function toneClassName(tone: IntegrationTone): string {
  switch (tone) {
    case "healthy":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
    case "attention":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
    case "error":
      return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

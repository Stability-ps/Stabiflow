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

// WhatsApp webhook subscription state (workspace_integrations
// .webhook_subscription_status, written by discoverAndStoreWhatsAppResources
// / integrations-connection-health). `hasRecentEvents` lets a workspace
// that is verifiably RECEIVING inbound events read as healthy even when the
// stored status is still 'unknown' (e.g. it connected before this feature
// shipped) - real delivery beats a stale flag.
export type WebhookSubscriptionPresentation = {
  label: string;
  tone: IntegrationTone;
  hint: string | null;
  /** true when the user should be nudged to run "Repair subscription". */
  actionable: boolean;
};

export function presentWebhookSubscription(status: string | null, hasRecentEvents: boolean): WebhookSubscriptionPresentation {
  if (status === "subscribed") {
    return { label: "Subscribed", tone: "healthy", hint: "Inbound messages will be delivered to StabiFlow.", actionable: false };
  }
  if (status === "not_subscribed") {
    return {
      label: "Not subscribed",
      tone: "attention",
      hint: "This WhatsApp Business Account is not subscribed to StabiFlow's webhook - inbound messages will not arrive until it is.",
      actionable: true,
    };
  }
  if (status === "error") {
    return {
      label: "Check failed",
      tone: "error",
      hint: "StabiFlow could not confirm the webhook subscription with Meta. Try \"Repair subscription\".",
      actionable: true,
    };
  }
  // 'unknown' / null
  if (hasRecentEvents) {
    return { label: "Receiving events", tone: "healthy", hint: "Inbound webhook events are arriving.", actionable: false };
  }
  return {
    label: "Unknown",
    tone: "neutral",
    hint: "StabiFlow has not confirmed the webhook subscription yet. Run \"Repair subscription\" or check connection.",
    actionable: true,
  };
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

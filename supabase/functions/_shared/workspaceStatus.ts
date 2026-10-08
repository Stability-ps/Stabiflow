// Launch-completion. The single authoritative check for whether a
// workspace is currently allowed to consume costly/mutating capability
// (Flow AI, Automations, provider sends/publishes) - mirrors the
// messagingWindow.ts precedent from Phase L-1: one shared function every
// gated call site imports, rather than each edge function re-deriving its
// own copy of the same predicate.
//
// 'trial' and 'active' are both usable states. 'suspended' and
// 'cancelled' are both blocked - the distinction between them is for
// operator/billing bookkeeping, not for authorization logic. A workspace
// with no workspace_billing row at all (should not happen given
// create_workspace() always inserts one, but fail safe rather than
// fail open) is treated as blocked, matching this codebase's existing
// fail-closed discipline (see messagingWindow.ts's "unknown" state).
//
// This NEVER blocks reads - it is only ever called from a write/consume
// entry point, after the caller's own permission has already been
// checked. Reads keep working through ordinary RLS regardless of status.

// deno-lint-ignore no-explicit-any
type AnySupabaseClient = any;

export type WorkspaceStatus = "trial" | "active" | "suspended" | "cancelled" | "unknown";

const BLOCKED_STATUSES = new Set<WorkspaceStatus>(["suspended", "cancelled", "unknown"]);

export function isBlockedStatus(status: WorkspaceStatus): boolean {
  return BLOCKED_STATUSES.has(status);
}

export async function getWorkspaceStatus(sb: AnySupabaseClient, workspaceId: string): Promise<WorkspaceStatus> {
  const { data, error } = await sb.from("workspace_billing").select("status").eq("workspace_id", workspaceId).maybeSingle();
  if (error || !data?.status) return "unknown";
  const status = data.status as string;
  if (status === "trial" || status === "active" || status === "suspended" || status === "cancelled") return status;
  return "unknown";
}

export type WorkspaceStatusGate = { allowed: true } | { allowed: false; status: WorkspaceStatus };

// The one call every gated entry point makes. Returns a discriminated
// result rather than throwing, so callers can shape their own
// error-response JSON (edge functions in this codebase don't share one
// exception-to-HTTP-response convention, matching the existing style of
// messagingWindow.ts's resolveMessagingWindow()).
export async function assertWorkspaceActive(sb: AnySupabaseClient, workspaceId: string): Promise<WorkspaceStatusGate> {
  const status = await getWorkspaceStatus(sb, workspaceId);
  if (isBlockedStatus(status)) return { allowed: false, status };
  return { allowed: true };
}

// Shared response body shape for the blocked case - every gated edge
// function returns exactly this (mirroring the messaging_window_closed
// precedent's discipline: a specific, legible error code, never a bare
// 403 indistinguishable from a permission failure).
export function workspaceSuspendedBody(status: WorkspaceStatus) {
  return {
    error: "workspace_suspended",
    status,
    message:
      status === "cancelled"
        ? "This workspace has been cancelled. Contact support to reactivate it."
        : "This workspace is currently suspended. Contact support to restore access.",
  };
}

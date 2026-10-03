import { AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceStatus } from "@/hooks/useWorkspaceStatus";

// Launch-completion: a clear, legible banner for a suspended/cancelled
// workspace - never a mysterious failure the first time a member tries to
// do something and gets blocked server-side. Reads remain unaffected
// (this banner doesn't hide anything), only mutating/costly actions
// (Flow AI, Automations, WhatsApp sends, campaign publish/resume) are
// actually blocked, enforced server-side regardless of this banner
// rendering correctly.
export function WorkspaceStatusBanner() {
  const { currentWorkspaceId } = useAuth();
  const { data } = useWorkspaceStatus(currentWorkspaceId);

  if (!data || (data.status !== "suspended" && data.status !== "cancelled")) return null;

  return (
    <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive sm:px-6">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <p>
        {data.status === "cancelled"
          ? "This workspace has been cancelled. You can still view your data, but AI, automations, WhatsApp sending, and campaign actions are disabled. Contact support to reactivate it."
          : "This workspace is currently suspended. You can still view your data, but AI, automations, WhatsApp sending, and campaign actions are disabled. Contact support to restore access."}
      </p>
    </div>
  );
}

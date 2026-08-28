import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  getOperatorWorkspace, searchOperatorWorkspaces, suspendOperatorWorkspace, unsuspendOperatorWorkspace,
} from "@/lib/operator";

// Launch-completion. Client-side is_platform_operator check below is UX
// only - it just avoids rendering a confusing page to someone who isn't
// an operator. The REAL authorization is server-side: every query on this
// page goes through the operator-workspaces edge function, which checks
// profiles.is_platform_operator via the service-role client on every
// single call, regardless of what this page renders.
export default function Operator() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const searchResults = useQuery({
    queryKey: ["operator-search", query],
    queryFn: () => searchOperatorWorkspaces(query),
    enabled: !!profile?.is_platform_operator,
  });

  const detail = useQuery({
    queryKey: ["operator-workspace", selectedWorkspaceId],
    queryFn: () => getOperatorWorkspace(selectedWorkspaceId as string),
    enabled: !!profile?.is_platform_operator && !!selectedWorkspaceId,
  });

  const suspendMutation = useMutation({
    mutationFn: () => suspendOperatorWorkspace(selectedWorkspaceId as string, reason),
    onSuccess: () => {
      toast.success("Workspace suspended");
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["operator-workspace", selectedWorkspaceId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unsuspendMutation = useMutation({
    mutationFn: () => unsuspendOperatorWorkspace(selectedWorkspaceId as string, reason),
    onSuccess: () => {
      toast.success("Workspace unsuspended");
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["operator-workspace", selectedWorkspaceId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!profile?.is_platform_operator) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-24 text-center text-muted-foreground">
        <ShieldAlert className="h-8 w-8" />
        <p>You don't have operator access.</p>
      </div>
    );
  }

  const status = detail.data?.billing?.status;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Operator console</h1>
        <p className="text-sm text-muted-foreground">Platform-level workspace lookup and status control. Every action here is audited.</p>
      </div>

      <div className="flex gap-2">
        <Input placeholder="Search workspaces by name or slug..." value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-sm" />
      </div>

      <div className="grid gap-4 md:grid-cols-[300px_1fr]">
        <div className="space-y-1 rounded-md border p-2">
          {(searchResults.data?.workspaces || []).map((ws) => (
            <button
              key={ws.id}
              onClick={() => setSelectedWorkspaceId(ws.id)}
              className={`w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${selectedWorkspaceId === ws.id ? "bg-muted font-medium" : ""}`}
            >
              {ws.name}
              <span className="ml-1.5 text-xs text-muted-foreground">/{ws.slug}</span>
            </button>
          ))}
          {searchResults.data && searchResults.data.workspaces.length === 0 && (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">No workspaces found.</p>
          )}
        </div>

        <div className="space-y-4">
          {!selectedWorkspaceId && <p className="text-sm text-muted-foreground">Select a workspace to view details.</p>}

          {detail.data && (
            <div className="space-y-4 rounded-md border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{detail.data.workspace.name}</h2>
                  <p className="text-xs text-muted-foreground">/{detail.data.workspace.slug} - created {new Date(detail.data.workspace.created_at).toLocaleDateString()}</p>
                </div>
                <Badge variant={status === "suspended" || status === "cancelled" ? "destructive" : "outline"}>{status || "unknown"}</Badge>
              </div>

              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <p className="font-medium">Plan</p>
                  <p className="text-muted-foreground">{detail.data.billing?.plan}</p>
                </div>
                <div>
                  <p className="font-medium">Trial ends</p>
                  <p className="text-muted-foreground">{detail.data.billing?.trial_ends_at ? new Date(detail.data.billing.trial_ends_at).toLocaleDateString() : "-"}</p>
                </div>
                <div>
                  <p className="font-medium">Members</p>
                  <p className="text-muted-foreground">{(detail.data.members ?? []).length}</p>
                </div>
                <div>
                  <p className="font-medium">Flow AI usage (last 100 events)</p>
                  <p className="text-muted-foreground">{detail.data.aiUsageSummary.totalTokens} tokens - {new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(detail.data.aiUsageSummary.totalCost)}</p>
                </div>
              </div>

              <div>
                <p className="mb-1 text-sm font-medium">Integrations</p>
                {(detail.data.integrations ?? []).length === 0 && <p className="text-sm text-muted-foreground">None connected.</p>}
                <div className="flex flex-wrap gap-2">
                  {(detail.data.integrations ?? []).map((i) => (
                    <Badge key={i.provider} variant="outline">{i.provider}: {i.status}{i.last_health_check_status ? ` (${i.last_health_check_status})` : ""}</Badge>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1 text-sm font-medium">Recent failed automation runs</p>
                {(detail.data.recentFailedAutomationRuns ?? []).length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
                {(detail.data.recentFailedAutomationRuns ?? []).map((r) => (
                  <p key={r.id} className="text-xs text-muted-foreground">{r.status} - {new Date(r.created_at).toLocaleString()}</p>
                ))}
              </div>

              <div className="space-y-2 border-t pt-3">
                <Textarea placeholder="Reason for this action (required, audited)" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
                <div className="flex gap-2">
                  {status === "suspended" || status === "cancelled" ? (
                    <Button onClick={() => unsuspendMutation.mutate()} disabled={!reason.trim() || unsuspendMutation.isPending}>Unsuspend workspace</Button>
                  ) : (
                    <Button variant="destructive" onClick={() => suspendMutation.mutate()} disabled={!reason.trim() || suspendMutation.isPending}>Suspend workspace</Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

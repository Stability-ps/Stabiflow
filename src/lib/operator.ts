import { supabase } from "@/integrations/supabase/client";

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("operator-workspaces", { body });
  if (error) {
    const message = (data as { error?: string } | null)?.error || error.message || "Request failed";
    throw new Error(message);
  }
  if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
}

export type OperatorWorkspaceSummary = { id: string; name: string; slug: string; created_at: string };

export function searchOperatorWorkspaces(query: string) {
  return invoke<{ ok: true; workspaces: OperatorWorkspaceSummary[] }>({ action: "search_workspaces", query });
}

export type OperatorWorkspaceDetail = {
  ok: true;
  workspace: OperatorWorkspaceSummary;
  billing: { plan: string; status: string; trial_ends_at: string | null; limits: Record<string, unknown> } | null;
  members: Array<{ user_id: string; role: string; joined_at: string; profiles: { full_name: string | null } | null }>;
  integrations: Array<{ provider: string; status: string; last_health_check_status: string | null; last_health_check_at: string | null }>;
  aiUsageSummary: { totalTokens: number; totalCost: number; blockedQuotaCount: number; sampleSize: number };
  recentFailedAutomationRuns: Array<{ id: string; automation_id: string; status: string; error: unknown; created_at: string }>;
};

export function getOperatorWorkspace(workspaceId: string) {
  return invoke<OperatorWorkspaceDetail>({ action: "get_workspace", workspace_id: workspaceId });
}

export function suspendOperatorWorkspace(workspaceId: string, reason: string) {
  return invoke<{ ok: true; status: string }>({ action: "suspend_workspace", workspace_id: workspaceId, reason });
}

export function unsuspendOperatorWorkspace(workspaceId: string, reason: string) {
  return invoke<{ ok: true; status: string }>({ action: "unsuspend_workspace", workspace_id: workspaceId, reason });
}

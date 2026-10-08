import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// workspace-export returns a binary ZIP body, not JSON - supabase-js's
// functions.invoke() is built around a JSON/text response, so this calls
// the function directly with fetch (same URL/auth shape invoke() uses
// internally) and triggers a browser download, mirroring the existing
// CSV-download pattern in CampaignPerformanceTable.tsx.
export async function exportWorkspaceData(workspaceId: string, slug: string): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Not signed in");

  const res = await fetch(`${SUPABASE_URL}/functions/v1/workspace-export`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ workspace_id: workspaceId }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error((body as { error?: string } | null)?.error || "Unable to export workspace data");
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug}-export.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function deleteWorkspace(workspaceId: string, confirm: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("workspace-delete", { body: { workspace_id: workspaceId, confirm } });
  if (error) {
    const message = (data as { error?: string } | null)?.error || error.message || "Unable to delete workspace";
    throw new Error(message);
  }
  if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) {
    throw new Error((data as { error: string }).error);
  }
}

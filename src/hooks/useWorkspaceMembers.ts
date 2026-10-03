import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useWorkspaceMembers(workspaceId: string | null) {
  return useQuery({
    queryKey: ["workspace-members", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_members")
        .select("id, user_id, role, joined_at, profile:profiles!workspace_members_user_id_fkey(id, full_name, avatar_url)")
        .eq("workspace_id", workspaceId as string)
        .order("joined_at", { ascending: true });
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!workspaceId,
  });
}

export function useWorkspacePendingInvitations(workspaceId: string | null) {
  return useQuery({
    queryKey: ["workspace-invitations", workspaceId, "pending"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_invitations")
        .select("id, email, role, created_at, expires_at, status, token")
        .eq("workspace_id", workspaceId as string)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!workspaceId,
  });
}

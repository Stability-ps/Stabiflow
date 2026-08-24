import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SocialDestination = {
  id: string;
  platform: "facebook" | "instagram";
  label: string;
};

// Reads the workspace-scoped connected-resource tables that already exist
// from Phase 3 (workspace_facebook_pages / workspace_instagram_accounts) -
// see the Phase 5 schema migration's naming-decision comment for why the
// Content module doesn't reinvent a "social_accounts" table. Combines both
// into one flat list of postable destinations for the composer's
// destination picker.
export function useSocialDestinations(workspaceId: string | null) {
  return useQuery({
    queryKey: ["social-destinations", workspaceId],
    queryFn: async (): Promise<SocialDestination[]> => {
      const [{ data: pages, error: pagesError }, { data: accounts, error: accountsError }] = await Promise.all([
        supabase.from("workspace_facebook_pages").select("id, page_name").eq("workspace_id", workspaceId as string).eq("is_active", true),
        supabase.from("workspace_instagram_accounts").select("id, username").eq("workspace_id", workspaceId as string).eq("is_active", true),
      ]);
      if (pagesError) throw new Error(pagesError.message);
      if (accountsError) throw new Error(accountsError.message);
      return [
        ...(pages || []).map((p) => ({ id: p.id, platform: "facebook" as const, label: p.page_name })),
        ...(accounts || []).map((a) => ({ id: a.id, platform: "instagram" as const, label: a.username ? `@${a.username}` : "Instagram account" })),
      ];
    },
    enabled: !!workspaceId,
  });
}

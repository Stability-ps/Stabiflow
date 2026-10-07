import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { adminConsole, AdminApiError, type AdminMe } from "@/lib/adminApi";

/**
 * Whether the signed-in user may open the StabiFlow Admin console. The
 * admin-console function is the authority (401/403 = no); this only decides
 * whether to show the entry points. Shared ["admin-me"] cache, one request.
 */
export function useAdminAccess(): boolean {
  const { user } = useAuth();
  const adminMe = useQuery({
    queryKey: ["admin-me"],
    queryFn: () => adminConsole<AdminMe>("me"),
    enabled: !!user,
    retry: (count, err) => !(err instanceof AdminApiError && (err.status === 401 || err.status === 403)) && count < 1,
    staleTime: 60_000,
  });
  return !!adminMe.data;
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getContentSchedulerSettings, setContentSchedulerSettings } from "@/lib/contentFunctions";

export function useContentSchedulerSettings(workspaceId: string | null) {
  return useQuery({
    queryKey: ["content-scheduler-settings", workspaceId],
    queryFn: () => getContentSchedulerSettings(workspaceId as string),
    enabled: !!workspaceId,
  });
}

export function useSetContentSchedulerSettings(workspaceId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => setContentSchedulerSettings(workspaceId as string, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["content-scheduler-settings", workspaceId] });
    },
  });
}

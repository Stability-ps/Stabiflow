import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AutomationActionType, AutomationEventType, ConditionOperator } from "@/lib/automations";

export type AutomationRow = {
  id: string;
  name: string;
  status: "draft" | "enabled" | "disabled";
  trigger_event_type: AutomationEventType;
  idle_timeout_minutes: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export function useAutomations(workspaceId: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["automations", workspaceId],
    queryFn: async (): Promise<AutomationRow[]> => {
      const { data, error } = await supabase
        .from("automations")
        .select("id, name, status, trigger_event_type, idle_timeout_minutes, created_by, created_at, updated_at")
        .eq("workspace_id", workspaceId as string)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data as AutomationRow[];
    },
    enabled: !!workspaceId,
  });

  useEffect(() => {
    if (!workspaceId) return;
    const channel = supabase
      .channel(`automations-${workspaceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "automations", filter: `workspace_id=eq.${workspaceId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["automations", workspaceId] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId, queryClient]);

  return query;
}

export type AutomationConditionRow = { id: string; field: string; operator: ConditionOperator; value: unknown; sort_order: number };
export type AutomationActionRow = { id: string; action_type: AutomationActionType; action_config: Record<string, unknown>; sort_order: number };

export function useAutomationConditions(workspaceId: string | null, automationId: string | null) {
  return useQuery({
    queryKey: ["automation-conditions", automationId],
    queryFn: async (): Promise<AutomationConditionRow[]> => {
      const { data, error } = await supabase.from("automation_conditions").select("id, field, operator, value, sort_order").eq("automation_id", automationId as string).order("sort_order");
      if (error) throw new Error(error.message);
      return data as AutomationConditionRow[];
    },
    enabled: !!workspaceId && !!automationId,
  });
}

export function useAutomationActions(workspaceId: string | null, automationId: string | null) {
  return useQuery({
    queryKey: ["automation-actions", automationId],
    queryFn: async (): Promise<AutomationActionRow[]> => {
      const { data, error } = await supabase.from("automation_actions").select("id, action_type, action_config, sort_order").eq("automation_id", automationId as string).order("sort_order");
      if (error) throw new Error(error.message);
      return data as AutomationActionRow[];
    },
    enabled: !!workspaceId && !!automationId,
  });
}

export type AutomationRunRow = {
  id: string;
  status: string;
  attempt_count: number;
  started_at: string | null;
  finished_at: string | null;
  next_retry_at: string | null;
  error: Record<string, unknown> | null;
  created_at: string;
};

export function useAutomationRuns(workspaceId: string | null, automationId: string | null) {
  return useQuery({
    queryKey: ["automation-runs", automationId],
    queryFn: async (): Promise<AutomationRunRow[]> => {
      const { data, error } = await supabase
        .from("automation_runs")
        .select("id, status, attempt_count, started_at, finished_at, next_retry_at, error, created_at")
        .eq("automation_id", automationId as string)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return data as AutomationRunRow[];
    },
    enabled: !!workspaceId && !!automationId,
  });
}

export type AutomationRunStepRow = {
  id: string;
  sort_order: number;
  action_type: string;
  status: string;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  started_at: string | null;
  finished_at: string | null;
};

export function useAutomationRunSteps(workspaceId: string | null, runId: string | null) {
  return useQuery({
    queryKey: ["automation-run-steps", runId],
    queryFn: async (): Promise<AutomationRunStepRow[]> => {
      const { data, error } = await supabase
        .from("automation_run_steps")
        .select("id, sort_order, action_type, status, result, error, started_at, finished_at")
        .eq("run_id", runId as string)
        .order("sort_order");
      if (error) throw new Error(error.message);
      return data as AutomationRunStepRow[];
    },
    enabled: !!workspaceId && !!runId,
  });
}

export type NotificationRow = {
  id: string;
  title: string;
  body: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

export function useNotifications(workspaceId: string | null, userId: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["notifications", workspaceId, userId],
    queryFn: async (): Promise<NotificationRow[]> => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, title, body, related_entity_type, related_entity_id, read_at, created_at")
        .eq("workspace_id", workspaceId as string)
        .eq("user_id", userId as string)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw new Error(error.message);
      return data as NotificationRow[];
    },
    enabled: !!workspaceId && !!userId,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!workspaceId || !userId) return;
    const channel = supabase
      .channel(`notifications-${workspaceId}-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `workspace_id=eq.${workspaceId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["notifications", workspaceId, userId] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId, userId, queryClient]);

  return query;
}

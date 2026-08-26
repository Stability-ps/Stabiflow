import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Pipeline = {
  id: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
};

export type PipelineStage = {
  id: string;
  pipeline_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  is_won_stage: boolean;
  is_lost_stage: boolean;
};

export function usePipelines(workspaceId: string | null) {
  return useQuery({
    queryKey: ["pipelines", workspaceId],
    queryFn: async (): Promise<Pipeline[]> => {
      const { data, error } = await supabase.from("pipelines").select("id, name, is_default, is_active").eq("workspace_id", workspaceId as string).order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return data as Pipeline[];
    },
    enabled: !!workspaceId,
  });
}

export function usePipelineStages(workspaceId: string | null, pipelineId: string | null) {
  return useQuery({
    queryKey: ["pipeline-stages", workspaceId, pipelineId],
    queryFn: async (): Promise<PipelineStage[]> => {
      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("id, pipeline_id, name, sort_order, is_active, is_won_stage, is_lost_stage")
        .eq("workspace_id", workspaceId as string)
        .eq("pipeline_id", pipelineId as string)
        .order("sort_order", { ascending: true });
      if (error) throw new Error(error.message);
      return data as PipelineStage[];
    },
    enabled: !!workspaceId && !!pipelineId,
  });
}

export type LeadRow = {
  id: string;
  human_reference: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  company_name: string | null;
  source: string;
  source_detail: string | null;
  status: "active" | "converted" | "lost";
  assigned_to: string | null;
  pipeline_id: string | null;
  pipeline_stage_id: string | null;
  qualification_status: "unqualified" | "qualifying" | "qualified" | "not_qualified";
  qualification_notes: string | null;
  qualification_reason: string | null;
  estimated_value: number | null;
  summary: string | null;
  created_from_conversation_id: string | null;
  lost_reason: string | null;
  created_at: string;
  updated_at: string;
  converted_at: string | null;
  lost_at: string | null;
};

const LEAD_COLUMNS =
  "id, human_reference, contact_name, phone, email, company_name, source, source_detail, status, assigned_to, pipeline_id, pipeline_stage_id, qualification_status, qualification_notes, qualification_reason, estimated_value, summary, created_from_conversation_id, lost_reason, created_at, updated_at, converted_at, lost_at";

export function useLeads(workspaceId: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["leads", workspaceId],
    queryFn: async (): Promise<LeadRow[]> => {
      const { data, error } = await supabase.from("leads").select(LEAD_COLUMNS).eq("workspace_id", workspaceId as string).order("updated_at", { ascending: false }).limit(500);
      if (error) throw new Error(error.message);
      return data as LeadRow[];
    },
    enabled: !!workspaceId,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!workspaceId) return;
    const channel = supabase
      .channel(`leads-${workspaceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter: `workspace_id=eq.${workspaceId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["leads", workspaceId] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId, queryClient]);

  return query;
}

export function useLead(leadId: string | null) {
  return useQuery({
    queryKey: ["lead", leadId],
    queryFn: async (): Promise<LeadRow | null> => {
      const { data, error } = await supabase.from("leads").select(LEAD_COLUMNS).eq("id", leadId as string).maybeSingle();
      if (error) throw new Error(error.message);
      return data as LeadRow | null;
    },
    enabled: !!leadId,
  });
}

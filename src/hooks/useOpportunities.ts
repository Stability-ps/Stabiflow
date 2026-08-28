import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type OpportunityRow = {
  id: string;
  lead_id: string;
  pipeline_id: string | null;
  pipeline_stage_id: string | null;
  title: string;
  description: string | null;
  assigned_to: string | null;
  estimated_value: number | null;
  actual_value: number | null;
  probability: number | null;
  status: "open" | "won" | "lost";
  won_at: string | null;
  lost_at: string | null;
  lost_reason: string | null;
  created_at: string;
  updated_at: string;
};

const OPPORTUNITY_COLUMNS =
  "id, lead_id, pipeline_id, pipeline_stage_id, title, description, assigned_to, estimated_value, actual_value, probability, status, won_at, lost_at, lost_reason, created_at, updated_at";

export function useOpportunitiesForLead(leadId: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["opportunities", "lead", leadId],
    queryFn: async (): Promise<OpportunityRow[]> => {
      const { data, error } = await supabase.from("opportunities").select(OPPORTUNITY_COLUMNS).eq("lead_id", leadId as string).order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data as OpportunityRow[];
    },
    enabled: !!leadId,
  });

  useEffect(() => {
    if (!leadId) return;
    const channel = supabase
      .channel(`opportunities-lead-${leadId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "opportunities", filter: `lead_id=eq.${leadId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["opportunities", "lead", leadId] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [leadId, queryClient]);

  return query;
}

export function useOpportunities(workspaceId: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["opportunities", "workspace", workspaceId],
    queryFn: async (): Promise<OpportunityRow[]> => {
      const { data, error } = await supabase.from("opportunities").select(OPPORTUNITY_COLUMNS).eq("workspace_id", workspaceId as string).order("updated_at", { ascending: false }).limit(500);
      if (error) throw new Error(error.message);
      return data as OpportunityRow[];
    },
    enabled: !!workspaceId,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!workspaceId) return;
    const channel = supabase
      .channel(`opportunities-${workspaceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "opportunities", filter: `workspace_id=eq.${workspaceId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["opportunities", "workspace", workspaceId] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId, queryClient]);

  return query;
}

export type CustomerRow = {
  id: string;
  lead_id: string | null;
  opportunity_id: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  company_name: string | null;
  customer_since: string;
};

const CUSTOMER_COLUMNS = "id, lead_id, opportunity_id, name, phone, email, company_name, customer_since";

export function useCustomerForOpportunity(opportunityId: string | null) {
  return useQuery({
    queryKey: ["customer", "opportunity", opportunityId],
    queryFn: async (): Promise<CustomerRow | null> => {
      const { data, error } = await supabase.from("customers").select(CUSTOMER_COLUMNS).eq("opportunity_id", opportunityId as string).maybeSingle();
      if (error) throw new Error(error.message);
      return data as CustomerRow | null;
    },
    enabled: !!opportunityId,
  });
}

export function useCustomer(customerId: string | null) {
  return useQuery({
    queryKey: ["customer", customerId],
    queryFn: async (): Promise<CustomerRow | null> => {
      const { data, error } = await supabase.from("customers").select(CUSTOMER_COLUMNS).eq("id", customerId as string).maybeSingle();
      if (error) throw new Error(error.message);
      return data as CustomerRow | null;
    },
    enabled: !!customerId,
  });
}

export function useOpportunity(opportunityId: string | null) {
  return useQuery({
    queryKey: ["opportunity", opportunityId],
    queryFn: async (): Promise<OpportunityRow | null> => {
      const { data, error } = await supabase.from("opportunities").select(OPPORTUNITY_COLUMNS).eq("id", opportunityId as string).maybeSingle();
      if (error) throw new Error(error.message);
      return data as OpportunityRow | null;
    },
    enabled: !!opportunityId,
  });
}

export function useCrmNotes(targetType: "lead" | "opportunity" | null, targetId: string | null) {
  return useQuery({
    queryKey: ["crm-notes", targetType, targetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_notes")
        .select("id, author_name, body, created_at")
        .eq("target_type", targetType as string)
        .eq("target_id", targetId as string)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!targetType && !!targetId,
  });
}

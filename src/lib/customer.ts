import { supabase } from "@/integrations/supabase/client";

// --- Conversation <-> customer link (inbox-actions) -----------------------

async function invokeInbox<T>(workspaceId: string, conversationId: string, action: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("inbox-actions", {
    body: { workspace_id: workspaceId, conversation_id: conversationId, action, ...params },
  });
  if (error) {
    const b = data as { error?: string; message?: string } | null;
    throw new Error(b?.message || b?.error || error.message || `${action} failed`);
  }
  if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) {
    const t = data as { error: string; message?: string };
    throw new Error(t.message || t.error);
  }
  return data as T;
}

export type LinkedCustomer = {
  id: string; name: string; customer_since: string;
  phone: string | null; email: string | null; company_name: string | null; status: string;
};

export function linkConversationCustomer(workspaceId: string, conversationId: string, customerId: string, change = false) {
  return invokeInbox<{ ok: true; customer: LinkedCustomer; unchanged?: boolean }>(workspaceId, conversationId, "link_customer", { customer_id: customerId, change });
}

export function unlinkConversationCustomer(workspaceId: string, conversationId: string) {
  return invokeInbox<{ ok: true; unchanged?: boolean }>(workspaceId, conversationId, "unlink_customer");
}

// --- Deterministic match candidates (RPC) -------------------------------

export type CustomerMatchCandidate = {
  customer_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  company_name: string | null;
  match_tier: "exact" | "possible";
  match_reason: string;
};

export async function customerMatchCandidates(workspaceId: string, conversationId: string): Promise<CustomerMatchCandidate[]> {
  const { data, error } = await supabase.rpc("customer_match_candidates", { p_workspace_id: workspaceId, p_conversation_id: conversationId });
  if (error) throw new Error(error.message);
  return (data ?? []) as CustomerMatchCandidate[];
}

// --- Customer 360 (RPC) --------------------------------------------------

export type RevenueByCurrency = { currency: string; total_minor: number; event_count?: number };

export type Customer360 = {
  identity: {
    id: string; name: string; phone: string | null; phone_normalized: string | null;
    email: string | null; company_name: string | null; status: string;
    customer_since: string; assigned_to: string | null; assigned_to_name: string | null; created_at: string;
  };
  counts: { conversations: number; leads: number; opportunities: number; open_opportunities: number };
  conversations: Array<{
    id: string; wa_id: string; phone_number: string; display_name: string | null; status: string;
    ai_enabled: boolean; inbox_status: string; assigned_staff_name: string | null;
    last_inbound_at: string | null; last_outbound_at: string | null; updated_at: string; customer_id: string | null;
  }>;
  leads: Array<{
    id: string; human_reference: string; contact_name: string | null; status: string; qualification_status: string;
    source: string; source_detail: string | null; estimated_value: number | null; created_at: string;
    stage_name: string | null; pipeline_name: string | null;
    attribution: { campaign_id: string | null; method: string | null; confidence: number | null } | null;
  }>;
  opportunities: Array<{
    id: string; title: string; status: string; estimated_value: number | null; actual_value: number | null;
    won_at: string | null; lost_at: string | null; created_at: string;
    stage_name: string | null; pipeline_name: string | null; owner_name: string | null;
  }>;
  revenue_by_currency: RevenueByCurrency[];
  documents: Array<{
    id: string; media_filename: string | null; media_mime_type: string | null; media_size_bytes: number | null;
    source: string; received_at: string | null; lead_id: string; created_at: string;
  }>;
  notes: Array<{ id: string; target_type: string; target_id: string; author_name: string; body: string; created_at: string }>;
  activity: Array<{ id: string; action: string; target_type: string; target_id: string | null; actor_role: string | null; actor_name: string | null; metadata: Record<string, unknown>; created_at: string }>;
  attribution: { campaign_id: string | null; method: string | null; confidence: number | null; platform: string | null; occurred_at: string } | null;
  timeline: Array<{ at: string; kind: string; label: string }>;
};

export async function fetchCustomer360(workspaceId: string, customerId: string): Promise<Customer360> {
  const { data, error } = await supabase.rpc("customer_360", { p_workspace_id: workspaceId, p_customer_id: customerId });
  if (error) throw new Error(error.message);
  return data as Customer360;
}

// --- Customers list (RPC) ---------------------------------------------

export type CustomerListRow = {
  id: string; name: string; phone: string | null; email: string | null; company_name: string | null; status: string;
  customer_since: string; assigned_to_name: string | null;
  open_opportunities: number; total_opportunities: number; last_interaction: string | null;
  revenue_by_currency: Array<{ currency: string; total_minor: number }>;
};

export async function searchCustomers(workspaceId: string, query: string): Promise<CustomerListRow[]> {
  const { data, error } = await supabase.rpc("customers_search", { p_workspace_id: workspaceId, p_query: query || undefined, p_limit: 100 });
  if (error) throw new Error(error.message);
  return (data ?? []) as CustomerListRow[];
}

// --- shared money formatting ----------------------------------------

export function formatMinor(currency: string, minor: number): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
}

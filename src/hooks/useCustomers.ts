import { useQuery } from "@tanstack/react-query";
import { customerMatchCandidates, fetchCustomer360, searchCustomers } from "@/lib/customer";

/** The one compact Customer 360 read model (customer_360 RPC). */
export function useCustomer360(workspaceId: string | null, customerId: string | null) {
  return useQuery({
    queryKey: ["customer-360", workspaceId, customerId],
    queryFn: () => fetchCustomer360(workspaceId as string, customerId as string),
    enabled: !!workspaceId && !!customerId,
  });
}

/** Deterministic customer candidates for a conversation (customer_match_candidates RPC). */
export function useCustomerMatchCandidates(workspaceId: string | null, conversationId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["customer-match-candidates", workspaceId, conversationId],
    queryFn: () => customerMatchCandidates(workspaceId as string, conversationId as string),
    enabled: !!workspaceId && !!conversationId && enabled,
  });
}

/** Thin Customers list (customers_search RPC). */
export function useCustomersSearch(workspaceId: string | null, query: string) {
  return useQuery({
    queryKey: ["customers-search", workspaceId, query.trim()],
    queryFn: () => searchCustomers(workspaceId as string, query.trim()),
    enabled: !!workspaceId,
  });
}

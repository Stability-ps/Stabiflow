// Maps raw resource-check results into the user-facing status vocabulary
// consumed by integrationStatus.ts on the frontend (Phase C instruction
// #8/#32/#33). Extracted from integrations-connection-health/index.ts so
// the mapping itself - notably the "zero selected resources is NOT the
// same as healthy" rule - is unit-testable without a live Supabase/Graph
// API call.
export function summarizeStatus(tokenHealthy: boolean, allHealthy: boolean, emptyMessage: string | null): { status: string; message: string } {
  if (!tokenHealthy) return { status: "reauthorization_required", message: "Your authorization has expired or was revoked. Reconnect to restore access." };
  if (emptyMessage) return { status: "needs_attention", message: emptyMessage };
  if (allHealthy) return { status: "healthy", message: "All connected resources are healthy." };
  return { status: "needs_attention", message: "One or more connected resources need attention." };
}

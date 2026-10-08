import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type LegalAcceptance = Pick<Tables<"legal_acceptances">, "document_type" | "document_version" | "accepted_at">;

/**
 * Records the current session's user as having accepted the CURRENT
 * Privacy Policy + Terms of Service versions. Takes no version/user
 * arguments - the server (accept_current_legal_terms()) derives both from
 * auth.uid() and public.legal_document_versions, never from the browser.
 * Safe to call more than once (idempotent per user+document+version).
 */
export async function acceptCurrentLegalTerms(): Promise<void> {
  const { error } = await supabase.rpc("accept_current_legal_terms");
  if (error) throw new Error(error.message);
}

/** Read-only: the CALLING user's own acceptance history (RLS-enforced). */
export async function getOwnLegalAcceptances(): Promise<LegalAcceptance[]> {
  const { data, error } = await supabase
    .from("legal_acceptances")
    .select("document_type, document_version, accepted_at")
    .order("accepted_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

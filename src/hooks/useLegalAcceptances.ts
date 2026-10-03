import { useQuery } from "@tanstack/react-query";
import { getOwnLegalAcceptances } from "@/lib/legalAcceptance";

/** The signed-in user's own Privacy/Terms acceptance history (RLS: own rows
 * only). Empty for any user who signed up before this tracking existed -
 * that is expected, not an error, and is never backfilled. */
export function useOwnLegalAcceptances(userId: string | null | undefined) {
  return useQuery({
    queryKey: ["legal-acceptances", userId],
    queryFn: getOwnLegalAcceptances,
    enabled: !!userId,
  });
}

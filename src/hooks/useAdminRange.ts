import { useSearchParams } from "react-router-dom";
import { resolveRange } from "@/lib/adminDateRange";

/** The admin date range from the URL, with ISO bounds for API calls. */
export function useAdminRange() {
  const [params] = useSearchParams();
  const r = resolveRange(params);
  return { ...r, fromIso: r.from.toISOString(), toIso: r.to.toISOString() };
}

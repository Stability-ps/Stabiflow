import { useSearchParams } from "react-router-dom";

/** Search/filter/page state kept in the URL so views are shareable and
 * survive back-navigation. */
export function useDirectoryState(defaultFilter = "all") {
  const [params, setParams] = useSearchParams();
  const search = params.get("q") ?? "";
  const filter = params.get("filter") ?? defaultFilter;
  const page = Math.max(Number(params.get("page")) || 0, 0);
  const set = (patch: Record<string, string | number | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || (k === "filter" && v === defaultFilter) || (k === "page" && v === 0)) next.delete(k);
      else next.set(k, String(v));
    }
    setParams(next, { replace: true });
  };
  return { search, filter, page, params, set };
}

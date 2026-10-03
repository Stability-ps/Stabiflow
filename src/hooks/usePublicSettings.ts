import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Admin-editable PUBLIC platform settings (copy, notices, support contact).
 * Readable by anyone via RLS (is_public). Values are rendered as text only.
 */
export function usePublicSettings() {
  return useQuery({
    queryKey: ["public-platform-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("platform_settings").select("key, value").eq("is_public", true);
      if (error) throw new Error(error.message);
      return Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) as Record<string, unknown>;
    },
    staleTime: 5 * 60_000,
  });
}

export function readText(value: unknown, key: string, max = 300): string | null {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : null;
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

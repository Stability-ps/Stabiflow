import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type WhatsAppLibraryTemplate = Database["public"]["Tables"]["whatsapp_template_library"]["Row"];

export function useWhatsAppTemplateLibrary() {
  return useQuery({
    queryKey: ["whatsapp-template-library"],
    queryFn: async () => {
      const rows: WhatsAppLibraryTemplate[] = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("whatsapp_template_library")
          .select("*")
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw new Error(error.message);
        const page = (data || []) as WhatsAppLibraryTemplate[];
        rows.push(...page);
        if (page.length < pageSize) break;
      }
      return rows;
    },
    staleTime: 10 * 60 * 1000,
  });
}

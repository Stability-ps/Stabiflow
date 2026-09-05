import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type WhatsAppTemplateRow = {
  id: string;
  name: string;
  language: string;
  category: string | null;
  provider_status: string;
  components: Array<{ type?: string; text?: string }>;
};

const TEMPLATE_COLUMNS = "id, name, language, category, provider_status, components";

// Broad read (inbox.view, same bar as the rest of the Inbox module) - the
// send action itself (inbox-actions' reply_template) independently
// re-verifies status/workspace ownership server-side, so a stale/cached
// list here is a UX nicety, never a security boundary.
export function useInboxTemplates(workspaceId: string | null) {
  return useQuery({
    queryKey: ["whatsapp-templates", workspaceId],
    queryFn: async (): Promise<WhatsAppTemplateRow[]> => {
      const { data, error } = await supabase
        .from("whatsapp_message_templates")
        .select(TEMPLATE_COLUMNS)
        .eq("workspace_id", workspaceId as string)
        .order("name", { ascending: true });
      if (error) throw new Error(error.message);
      return data as WhatsAppTemplateRow[];
    },
    enabled: !!workspaceId,
  });
}

export function approvedTemplates(templates: WhatsAppTemplateRow[] | undefined): WhatsAppTemplateRow[] {
  return (templates || []).filter((t) => t.provider_status === "APPROVED");
}

export function templateBodyParameterCount(template: WhatsAppTemplateRow): number {
  const body = template.components.find((c) => (c.type || "").toUpperCase() === "BODY");
  if (!body?.text) return 0;
  const matches = body.text.match(/\{\{\s*(\d+)\s*\}\}/g) || [];
  return new Set(matches.map((m) => m.replace(/[^\d]/g, ""))).size;
}

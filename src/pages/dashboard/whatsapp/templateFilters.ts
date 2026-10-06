import type { WhatsAppTemplateRow } from "@/hooks/useInboxTemplates";

export function whatsappTemplateBody(template: WhatsAppTemplateRow): string {
  const body = template.components.find((c) => (c.type || "").toUpperCase() === "BODY");
  return body?.text?.trim() || "—";
}

export function filterWhatsAppTemplates(
  templates: WhatsAppTemplateRow[],
  query: string,
  category: string,
  status: string,
): WhatsAppTemplateRow[] {
  const needle = query.trim().toLowerCase();
  return templates.filter((template) => {
    const matchesQuery =
      !needle ||
      [
        template.name,
        template.language,
        template.category || "",
        template.provider_status,
        whatsappTemplateBody(template),
      ].some((value) => value.toLowerCase().includes(needle));
    const matchesCategory =
      category === "ALL" || (template.category || "Uncategorised") === category;
    const matchesStatus = status === "ALL" || template.provider_status === status;
    return matchesQuery && matchesCategory && matchesStatus;
  });
}

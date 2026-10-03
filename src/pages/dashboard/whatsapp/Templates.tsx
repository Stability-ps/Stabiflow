import { Link } from "react-router-dom";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { useInboxTemplates, type WhatsAppTemplateRow } from "@/hooks/useInboxTemplates";
import { useWhatsAppOutlet } from "@/pages/dashboard/whatsapp/whatsappOutlet";

function bodyPreview(template: WhatsAppTemplateRow): string {
  const body = template.components.find((c) => (c.type || "").toUpperCase() === "BODY");
  return body?.text?.trim() || "—";
}

function statusTone(status: string): "default" | "secondary" | "outline" | "destructive" {
  const s = status.toUpperCase();
  if (s === "APPROVED") return "default";
  if (s === "REJECTED" || s === "DISABLED" || s === "PAUSED") return "destructive";
  if (s === "PENDING") return "outline";
  return "secondary";
}

// Read-only view of the approved-and-pending message templates synced from
// Meta for this workspace (whatsapp_message_templates). StabiFlow does not
// author or submit templates in V1 - they are created in Meta's own
// interface and pulled in on connect / Refresh under Settings.
export default function WhatsAppTemplates() {
  const { workspaceId } = useWhatsAppOutlet();
  const { data: templates, isLoading } = useInboxTemplates(workspaceId);

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  }

  if (!templates || templates.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No templates synced yet"
        description="Message templates are created in Meta and synced into StabiFlow. Connect WhatsApp, or use Refresh under Settings, to pull them in."
        action={<Link to="/app/whatsapp/settings" className="text-sm font-medium underline underline-offset-2">Go to WhatsApp Settings</Link>}
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Synced from Meta. Approved templates can be sent from a conversation when the 24-hour messaging window is closed.
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <caption className="sr-only">WhatsApp message templates</caption>
          <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Name</th>
              <th scope="col" className="px-4 py-2 font-medium">Language</th>
              <th scope="col" className="px-4 py-2 font-medium">Category</th>
              <th scope="col" className="px-4 py-2 font-medium">Status</th>
              <th scope="col" className="px-4 py-2 font-medium">Body</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id} className="border-b last:border-b-0">
                <td className="px-4 py-2.5 font-medium">{t.name}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{t.language}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{t.category || "—"}</td>
                <td className="px-4 py-2.5"><Badge variant={statusTone(t.provider_status)}>{t.provider_status}</Badge></td>
                <td className="px-4 py-2.5 max-w-md text-muted-foreground"><span className="line-clamp-2">{bodyPreview(t)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

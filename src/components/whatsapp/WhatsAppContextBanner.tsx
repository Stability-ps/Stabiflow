import { Link } from "react-router-dom";
import { ArrowLeft, MessageCircle } from "lucide-react";

// Shown on the shared Automations / Analytics pages when the user arrived
// via a WhatsApp section link (e.g. /app/automations?trigger=conversation).
// Keeps the "I'm still in a WhatsApp workflow" context visible without
// duplicating those modules inside the WhatsApp area.
export function WhatsAppContextBanner({ label, backTo = "/app/whatsapp/inbox" }: { label: string; backTo?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm">
      <MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="text-muted-foreground">{label}</span>
      <Link to={backTo} className="ml-auto inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to WhatsApp
      </Link>
    </div>
  );
}

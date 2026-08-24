import { Plug } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/PlaceholderPage";

export default function Integrations() {
  return (
    <PlaceholderPage
      icon={Plug}
      title="Integrations"
      description="Connect Meta, WhatsApp Business, and other providers to this workspace."
      emptyTitle="No integrations connected"
      emptyDescription="Connecting a provider here will let you manage ad accounts, pages, and WhatsApp numbers for this workspace. Nothing is connected yet."
    />
  );
}

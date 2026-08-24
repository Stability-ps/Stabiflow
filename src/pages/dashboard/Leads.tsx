import { Users } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/PlaceholderPage";

export default function Leads() {
  return (
    <PlaceholderPage
      icon={Users}
      title="Leads"
      description="Leads, qualification, and your configurable pipeline stages."
      emptyTitle="No leads yet"
      emptyDescription="Leads created from conversations and campaigns will appear here, tracked through a pipeline you configure for this workspace."
    />
  );
}

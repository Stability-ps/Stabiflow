import { Megaphone } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/PlaceholderPage";

export default function Campaigns() {
  return (
    <PlaceholderPage
      icon={Megaphone}
      title="Campaigns"
      description="Meta advertising campaigns, creatives, and performance."
      emptyTitle="No campaigns yet"
      emptyDescription="Connect a Meta account under Integrations, then create your first campaign here."
    />
  );
}

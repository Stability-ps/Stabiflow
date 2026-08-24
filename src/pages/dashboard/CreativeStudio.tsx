import { Palette } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/PlaceholderPage";

export default function CreativeStudio() {
  return (
    <PlaceholderPage
      icon={Palette}
      title="Creative Studio"
      description="AI-assisted copy, headlines, and creative variations for your campaigns."
      emptyTitle="Creative Studio isn't built yet"
      emptyDescription="This will become the AI-assisted workspace for generating and testing ad creative once Campaigns is in place."
    />
  );
}

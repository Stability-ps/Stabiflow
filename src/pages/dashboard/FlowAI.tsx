import { Sparkles } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/PlaceholderPage";

export default function FlowAI() {
  return (
    <PlaceholderPage
      icon={Sparkles}
      title="Flow AI"
      description="Campaign and creative recommendations, fatigue warnings, and budget suggestions - always with human approval before anything changes."
      emptyTitle="Flow AI isn't active yet"
      emptyDescription="Flow AI needs campaign and conversion data to generate recommendations. No automatic changes will ever be made without your explicit approval."
    />
  );
}

import { BarChart3 } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/PlaceholderPage";

export default function Analytics() {
  return (
    <PlaceholderPage
      icon={BarChart3}
      title="Analytics"
      description="Spend, conversations, leads, customers, revenue, and cost-per-outcome, all the way through the funnel."
      emptyTitle="No analytics yet"
      emptyDescription="Analytics will populate once campaigns, conversations, and leads start generating real activity in this workspace."
    />
  );
}

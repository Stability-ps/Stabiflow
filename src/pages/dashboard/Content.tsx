import { FileText } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/PlaceholderPage";

export default function Content() {
  return (
    <PlaceholderPage
      icon={FileText}
      title="Content"
      description="Calendar, scheduled posts, drafts, and your Media Library."
      emptyTitle="No content yet"
      emptyDescription="The content scheduler, calendar, and Media Library land here in a later phase - nothing is connected yet."
    />
  );
}

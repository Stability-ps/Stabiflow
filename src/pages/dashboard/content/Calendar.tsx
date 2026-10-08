import { CalendarMonthView } from "@/components/content/CalendarMonthView";
import { SectionHeader } from "./SectionHeader";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceTimezone } from "@/hooks/useWorkspaceTimezone";

export default function Calendar() {
  const { currentWorkspaceId } = useAuth();
  const timezone = useWorkspaceTimezone(currentWorkspaceId);

  return (
    <div className="space-y-4">
      <SectionHeader title="Calendar" description="Scheduled, published, and failed posts by day." />
      <CalendarMonthView workspaceTimezone={timezone} />
    </div>
  );
}

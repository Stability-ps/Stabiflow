import { CalendarMonthView } from "@/components/content/CalendarMonthView";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceTimezone } from "@/hooks/useWorkspaceTimezone";

export default function Calendar() {
  const { currentWorkspaceId } = useAuth();
  const timezone = useWorkspaceTimezone(currentWorkspaceId);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Calendar</h2>
        <p className="text-sm text-muted-foreground">Scheduled, published, and failed posts by day.</p>
      </div>
      <CalendarMonthView workspaceTimezone={timezone} />
    </div>
  );
}

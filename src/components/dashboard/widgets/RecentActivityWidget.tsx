import { useMemo } from "react";
import { TrendingUp } from "lucide-react";
import { useDashboardContext } from "@/lib/dashboard/DashboardContext";
import { useWorkspaceActivity } from "@/hooks/useWorkspaceActivity";
import { formatActivityAction, isDashboardActivity } from "@/lib/activityPresentation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyWidgetState } from "@/components/dashboard/EmptyWidgetState";

export function RecentActivityWidget() {
  const { workspaceId, timezone } = useDashboardContext();
  const query = useWorkspaceActivity(workspaceId);
  const visible = useMemo(() => (query.data ?? []).filter((row) => isDashboardActivity(row.action)).slice(0, 6), [query.data]);

  return (
    <Card className="h-full">
      <CardHeader><CardTitle className="text-base">Recent activity</CardTitle></CardHeader>
      <CardContent>
        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : query.isError ? (
          <p className="text-sm text-destructive">Unable to load recent activity.</p>
        ) : visible.length === 0 ? (
          <EmptyWidgetState icon={TrendingUp} title="No activity yet" description="Actions taken in this workspace will show up here." />
        ) : (
          <ul className="space-y-2">
            {visible.map((row) => (
              <li key={row.id} className="flex flex-col gap-1 rounded-lg border p-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span>{formatActivityAction(row.action)}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{new Date(row.created_at).toLocaleString(undefined, { timeZone: timezone })}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

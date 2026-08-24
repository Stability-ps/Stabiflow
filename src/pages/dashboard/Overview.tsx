import {
  BarChart3, DollarSign, MessageSquare, Sparkles, TrendingUp, Users, Wallet,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceActivity } from "@/hooks/useWorkspaceActivity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/layout/MetricCard";
import { EmptyState } from "@/components/EmptyState";

export default function Overview() {
  const { currentMembership, currentWorkspaceId } = useAuth();
  const activityQuery = useWorkspaceActivity(currentWorkspaceId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {currentMembership ? `${currentMembership.workspace.name} - business overview` : "Business overview"}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard icon={Wallet} label="Campaign spend" emptyMessage="No campaign data yet" />
        <MetricCard icon={MessageSquare} label="Conversations" emptyMessage="No conversations yet" />
        <MetricCard icon={Users} label="Qualified leads" emptyMessage="No leads yet" />
        <MetricCard icon={DollarSign} label="Customers" emptyMessage="No customers yet" />
        <MetricCard icon={TrendingUp} label="Revenue" emptyMessage="No revenue recorded yet" />
        <MetricCard icon={BarChart3} label="ROAS" emptyMessage="Not enough data yet" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Campaign performance</CardTitle></CardHeader>
          <CardContent>
            <EmptyState icon={BarChart3} title="No campaign data yet" description="Connect Meta and launch a campaign to see performance here." />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Recent conversations</CardTitle></CardHeader>
          <CardContent>
            <EmptyState icon={MessageSquare} title="No conversations yet" description="Connect WhatsApp to start receiving conversations here." />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Flow AI recommendations</CardTitle></CardHeader>
        <CardContent>
          <EmptyState
            icon={Sparkles}
            title="No recommendations yet"
            description="Flow AI needs campaign and conversion data before it can suggest anything - recommendations always require your approval before anything changes."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent activity</CardTitle></CardHeader>
        <CardContent>
          {activityQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : activityQuery.isError ? (
            <p className="text-sm text-destructive">Unable to load recent activity.</p>
          ) : !activityQuery.data?.length ? (
            <EmptyState icon={TrendingUp} title="No activity yet" description="Actions taken in this workspace will show up here." />
          ) : (
            <ul className="space-y-2">
              {activityQuery.data.map((row) => (
                <li key={row.id} className="flex items-center justify-between rounded-lg border p-2.5 text-sm">
                  <span>{row.action.replace(/_/g, " ")}</span>
                  <span className="text-xs text-muted-foreground">{new Date(row.created_at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

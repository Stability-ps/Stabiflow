import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Placeholder authenticated shell for Phase 3 (auth + workspaces only).
// The real navigation/branding shell (Dashboard/Content/Campaigns/
// Creative Studio/Inbox/Leads/Analytics/Flow AI/Integrations/Settings)
// is Phase 4.
export default function Dashboard() {
  const { profile, memberships, membershipsLoading, currentMembership, currentWorkspaceId, setCurrentWorkspaceId, signOut } = useAuth();

  if (!membershipsLoading && memberships.length === 0) return <Navigate to="/create-workspace" replace />;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">StabiFlow</h1>
          <Button variant="outline" size="sm" onClick={() => signOut()}>Sign out</Button>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Signed in as</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {profile?.full_name || "—"}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Your workspaces</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {memberships.map((m) => (
              <button
                key={m.workspaceId}
                type="button"
                onClick={() => setCurrentWorkspaceId(m.workspaceId)}
                className={`block w-full rounded-lg border p-3 text-left text-sm ${m.workspaceId === currentWorkspaceId ? "border-primary bg-primary/5" : ""}`}
              >
                <span className="font-medium">{m.workspace.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{m.role}</span>
              </button>
            ))}
          </CardContent>
        </Card>

        {currentMembership ? (
          <Card>
            <CardHeader><CardTitle className="text-base">Current workspace</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <p><span className="font-medium text-foreground">{currentMembership.workspace.name}</span></p>
              <p>Your role: {currentMembership.role}</p>
              <p className="mt-2 text-xs">Content, Campaigns, WhatsApp Inbox, and Leads land here in Phases 5-8.</p>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

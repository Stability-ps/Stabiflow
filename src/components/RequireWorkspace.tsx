import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

// Separate from RequireAuth on purpose: a signed-in user with zero
// workspaces is a real, valid state (right after sign-up) - it needs its
// own redirect target (create-workspace), not a generic "not authorized."
export function RequireWorkspace({ children }: { children: ReactNode }) {
  const { membershipsLoading, memberships, currentWorkspaceId } = useAuth();

  if (membershipsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading your workspaces...</p>
      </div>
    );
  }

  if (memberships.length === 0 || !currentWorkspaceId) {
    return <Navigate to="/create-workspace" replace />;
  }

  return <>{children}</>;
}

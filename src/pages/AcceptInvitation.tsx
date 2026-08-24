import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { acceptWorkspaceInvitation } from "@/lib/workspaceMembers";

// Reached via a link an admin copies from Settings > Members (StabiFlow
// doesn't send invitation emails yet - see the Members tab). Deliberately
// NOT wrapped in RequireWorkspace: a user with zero workspaces accepting
// their very first invitation must be able to reach this page.
export default function AcceptInvitation() {
  const { user, loading, addWorkspaceMembership, setCurrentWorkspaceId } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"idle" | "accepting" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !user || !token || status !== "idle") return;
    setStatus("accepting");
    (async () => {
      try {
        const workspaceId = await acceptWorkspaceInvitation(token);
        // Fetch exactly the one membership row just created - synchronous
        // merge into AuthContext before navigating, same pattern as
        // CreateWorkspace's fix: RequireWorkspace must see this workspace
        // in `memberships` on its very first render of "/", not after a
        // separate refetch that might resolve later or with stale data.
        const { data: membershipRow } = await supabase
          .from("workspace_members")
          .select("workspace_id, role, workspace:workspaces(*)")
          .eq("workspace_id", workspaceId)
          .eq("user_id", user.id)
          .single();
        if (membershipRow?.workspace) {
          addWorkspaceMembership({ workspaceId: membershipRow.workspace_id, role: membershipRow.role, workspace: membershipRow.workspace });
        }
        setCurrentWorkspaceId(workspaceId);
        navigate("/", { replace: true });
      } catch (error) {
        setStatus("error");
        setErrorMessage(error instanceof Error ? error.message : "Unable to accept this invitation");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, token, status]);

  if (!token) {
    return (
      <AuthLayout>
        <Card className="w-full max-w-sm">
          <CardHeader><CardTitle className="text-xl">Invalid invitation link</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">This link is missing its invitation token. Ask whoever invited you to resend it.</p>
          </CardContent>
        </Card>
      </AuthLayout>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <AuthLayout>
        <Card className="w-full max-w-sm">
          <CardHeader><CardTitle className="text-xl">Sign in to accept this invitation</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Sign in (or create an account) using the exact email address this invitation was sent to.</p>
            <Button className="w-full" asChild>
              <Link to={`/login?redirect=${encodeURIComponent(`/accept-invitation?token=${token}`)}`}>Sign in</Link>
            </Button>
            <Button className="w-full" variant="outline" asChild>
              <Link to={`/signup?redirect=${encodeURIComponent(`/accept-invitation?token=${token}`)}`}>Create an account</Link>
            </Button>
          </CardContent>
        </Card>
      </AuthLayout>
    );
  }

  if (status === "error") {
    return (
      <AuthLayout>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl"><XCircle className="h-5 w-5 text-destructive" /> Couldn't accept invitation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{errorMessage}</p>
            <Button className="w-full" variant="outline" asChild><Link to="/">Go to dashboard</Link></Button>
          </CardContent>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Joining workspace...</p>
    </div>
  );
}

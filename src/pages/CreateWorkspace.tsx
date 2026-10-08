import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { slugify } from "@/lib/slug";

export default function CreateWorkspace() {
  const { user, addWorkspaceMembership, setCurrentWorkspaceId, signOut } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const slug = slugify(name);
    if (!slug) {
      toast.error("Enter a workspace name");
      return;
    }
    if (!user) {
      toast.error("You've been signed out - please sign in again");
      return;
    }
    setSubmitting(true);
    // create_workspace() is SECURITY DEFINER: it inserts the workspace AND
    // the caller's owner membership atomically, so there's never a moment
    // where a workspace exists with no owner. It returns only the new
    // workspace's id.
    const { data: workspaceId, error } = await supabase.rpc("create_workspace", { p_name: name.trim(), p_slug: slug });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!workspaceId) {
      // The RPC is declared `returns uuid` and never returns null on
      // success - this branch means something changed server-side in a
      // way this client doesn't understand. Surfacing it beats silently
      // proceeding as if a workspace id existed.
      toast.error("Workspace was created, but no workspace id was returned. Please refresh and try again.");
      return;
    }

    // Update AuthContext directly from data we already have (the RPC's own
    // returned id, plus the name/slug just submitted and the authenticated
    // user as owner) - a plain setState, applied before anything else in
    // this function runs. RequireWorkspace reads memberships/
    // currentWorkspaceId from this SAME context, so this is what makes the
    // redirect below safe: no dependency on a network round-trip.
    //
    // Deliberately NOT followed by a "reconcile with the server" background
    // refreshMemberships() call: an earlier version of this fix added one,
    // and the regression test below caught it actively making things WORSE
    // - a refetch that resolves with stale/incomplete data (network lag,
    // read-after-write delay) would silently overwrite this correct
    // optimistic state and bounce the user back out. This data isn't an
    // approximation that needs reconciling; it's exactly what the server
    // just persisted, so there's nothing to reconcile.
    const nowIso = new Date().toISOString();
    addWorkspaceMembership({
      workspaceId,
      role: "owner",
      workspace: { id: workspaceId, name: name.trim(), slug, created_by: user.id, created_at: nowIso, updated_at: nowIso },
    });
    setCurrentWorkspaceId(workspaceId);
    toast.success(`${name.trim()} created`);
    navigate("/app", { replace: true });
  };

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Create your workspace</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            A workspace is your company's home in StabiFlow - content, campaigns, WhatsApp, and leads all live inside it, and no other
            workspace can ever see them.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="workspaceName">Company name</Label>
              <Input id="workspaceName" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Retail" />
              {name.trim() ? <p className="text-xs text-muted-foreground">stabiflow.com/{slugify(name)}</p> : null}
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Creating..." : "Create workspace"}
            </Button>
          </form>
          <Button variant="ghost" className="mt-2 w-full" onClick={() => signOut()}>Sign out</Button>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}

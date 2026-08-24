import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { slugify } from "@/lib/slug";

export default function CreateWorkspace() {
  const { refreshMemberships, setCurrentWorkspaceId, signOut } = useAuth();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const slug = slugify(name);
    if (!slug) {
      toast.error("Enter a workspace name");
      return;
    }
    setSubmitting(true);
    // create_workspace() is SECURITY DEFINER: it inserts the workspace AND
    // the caller's owner membership atomically, so there's never a moment
    // where a workspace exists with no owner.
    const { data: workspaceId, error } = await supabase.rpc("create_workspace", { p_name: name.trim(), p_slug: slug });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await refreshMemberships();
    if (workspaceId) setCurrentWorkspaceId(workspaceId);
    toast.success(`${name.trim()} created`);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
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
              <Input id="workspaceName" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acapolite Consulting" />
              {name.trim() ? <p className="text-xs text-muted-foreground">stabiflow.com/{slugify(name)}</p> : null}
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Creating..." : "Create workspace"}
            </Button>
          </form>
          <Button variant="ghost" className="mt-2 w-full" onClick={() => signOut()}>Sign out</Button>
        </CardContent>
      </Card>
    </div>
  );
}

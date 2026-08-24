import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PostsList } from "@/components/content/PostsList";
import { ComposePostDialog } from "@/components/content/ComposePostDialog";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceTimezone } from "@/hooks/useWorkspaceTimezone";

export default function Scheduled() {
  const { currentWorkspaceId, hasPermission } = useAuth();
  const timezone = useWorkspaceTimezone(currentWorkspaceId);
  const [composeOpen, setComposeOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Scheduled</h2>
          <p className="text-sm text-muted-foreground">Posts queued to publish, plus any that failed along the way.</p>
        </div>
        {hasPermission("content.create") && (
          <Button onClick={() => setComposeOpen(true)}><Plus className="mr-2 h-4 w-4" /> New post</Button>
        )}
      </div>
      <PostsList statusFilter="scheduled" workspaceTimezone={timezone} emptyTitle="No scheduled posts yet" emptyDescription="Create or schedule your first post." />
      <ComposePostDialog open={composeOpen} onOpenChange={setComposeOpen} workspaceTimezone={timezone} />
    </div>
  );
}

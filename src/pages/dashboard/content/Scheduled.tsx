import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PostsList } from "@/components/content/PostsList";
import { ComposePostDialog } from "@/components/content/ComposePostDialog";
import { SectionHeader } from "./SectionHeader";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceTimezone } from "@/hooks/useWorkspaceTimezone";

export default function Scheduled() {
  const { currentWorkspaceId, hasPermission } = useAuth();
  const timezone = useWorkspaceTimezone(currentWorkspaceId);
  const [composeOpen, setComposeOpen] = useState(false);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Scheduled"
        description="Posts queued to publish, plus any that failed along the way."
        action={hasPermission("content.create") && (
          <Button onClick={() => setComposeOpen(true)}><Plus aria-hidden="true" /> New post</Button>
        )}
      />
      <PostsList statusFilter="scheduled" workspaceTimezone={timezone} emptyTitle="No scheduled posts yet" emptyDescription="Create or schedule your first post." />
      <ComposePostDialog open={composeOpen} onOpenChange={setComposeOpen} workspaceTimezone={timezone} />
    </div>
  );
}

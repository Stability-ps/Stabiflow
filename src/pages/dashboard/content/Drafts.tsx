import { PostsList } from "@/components/content/PostsList";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceTimezone } from "@/hooks/useWorkspaceTimezone";

export default function Drafts() {
  const { currentWorkspaceId } = useAuth();
  const timezone = useWorkspaceTimezone(currentWorkspaceId);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Drafts</h2>
        <p className="text-sm text-muted-foreground">Posts saved but not yet scheduled.</p>
      </div>
      <PostsList statusFilter="draft" workspaceTimezone={timezone} emptyTitle="No drafts yet" emptyDescription="Duplicate a post or save one as a draft to see it here." />
    </div>
  );
}

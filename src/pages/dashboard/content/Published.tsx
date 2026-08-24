import { PostsList } from "@/components/content/PostsList";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceTimezone } from "@/hooks/useWorkspaceTimezone";

export default function Published() {
  const { currentWorkspaceId } = useAuth();
  const timezone = useWorkspaceTimezone(currentWorkspaceId);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Published</h2>
        <p className="text-sm text-muted-foreground">Posts that have gone live on Facebook or Instagram.</p>
      </div>
      <PostsList statusFilter="published" workspaceTimezone={timezone} emptyTitle="Nothing published yet" emptyDescription="Posts appear here once they've gone live." />
    </div>
  );
}

import { PostsList } from "@/components/content/PostsList";
import { SectionHeader } from "./SectionHeader";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceTimezone } from "@/hooks/useWorkspaceTimezone";

export default function Published() {
  const { currentWorkspaceId } = useAuth();
  const timezone = useWorkspaceTimezone(currentWorkspaceId);

  return (
    <div className="space-y-4">
      <SectionHeader title="Published" description="Posts that have gone live on Facebook or Instagram." />
      <PostsList statusFilter="published" workspaceTimezone={timezone} emptyTitle="Nothing published yet" emptyDescription="Posts appear here once they've gone live." />
    </div>
  );
}

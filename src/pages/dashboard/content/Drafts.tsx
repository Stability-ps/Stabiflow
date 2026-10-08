import { PostsList } from "@/components/content/PostsList";
import { SectionHeader } from "./SectionHeader";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceTimezone } from "@/hooks/useWorkspaceTimezone";

export default function Drafts() {
  const { currentWorkspaceId } = useAuth();
  const timezone = useWorkspaceTimezone(currentWorkspaceId);

  return (
    <div className="space-y-4">
      <SectionHeader title="Drafts" description="Posts saved but not yet scheduled." />
      <PostsList statusFilter="draft" workspaceTimezone={timezone} emptyTitle="No drafts yet" emptyDescription="Duplicate a post or save one as a draft to see it here." />
    </div>
  );
}

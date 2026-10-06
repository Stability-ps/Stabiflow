import { useEffect, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/** "Was this helpful?" - one answer per user per article; changing it updates the answer. */
export function GuideFeedback({ articleSlug }: { articleSlug: string }) {
  const { user, currentWorkspaceId } = useAuth();
  const [answer, setAnswer] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase
      .from("guide_article_feedback")
      .select("helpful")
      .eq("user_id", user.id)
      .eq("article_slug", articleSlug)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled && data) setAnswer(data.helpful); });
    return () => { cancelled = true; };
  }, [user, articleSlug]);

  async function submit(helpful: boolean) {
    if (!user) return;
    setAnswer(helpful);
    setSaving(true);
    // Best effort: feedback must never interrupt reading the guide.
    await supabase
      .from("guide_article_feedback")
      .upsert({ user_id: user.id, article_slug: articleSlug, workspace_id: currentWorkspaceId, helpful }, { onConflict: "user_id,article_slug" });
    setSaving(false);
  }

  return (
    <div className="guide-no-print flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between" aria-live="polite">
      <p className="text-sm font-medium">{answer === null ? "Was this helpful?" : answer ? "Thanks - glad it helped." : "Thanks for telling us. We'll use this to improve the guide."}</p>
      <div className="flex gap-2" role="group" aria-label="Was this helpful?">
        <Button type="button" size="sm" variant={answer === true ? "default" : "outline"} aria-pressed={answer === true} disabled={saving} onClick={() => submit(true)}>
          <ThumbsUp className="mr-1.5 h-4 w-4" aria-hidden="true" /> Helpful
        </Button>
        <Button type="button" size="sm" variant={answer === false ? "default" : "outline"} aria-pressed={answer === false} disabled={saving} onClick={() => submit(false)}>
          <ThumbsDown className="mr-1.5 h-4 w-4" aria-hidden="true" /> Not helpful
        </Button>
      </div>
    </div>
  );
}

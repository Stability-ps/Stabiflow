import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { updateWorkspaceAiSettings, useWorkspaceAiSettings } from "@/hooks/useWorkspaceAiSettings";

const MAX = 25;

/** Workspace-specific phrases that hand a WhatsApp conversation to a person,
 * on top of StabiFlow's built-in detection. */
export function HandoffKeywordsCard({ workspaceId, canManage, className }: { workspaceId: string; canManage: boolean; className?: string }) {
  const qc = useQueryClient();
  const { data } = useWorkspaceAiSettings(workspaceId);
  const keywords = data?.handoff_keywords ?? [];
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (next: string[], message: string) => {
    setSaving(true);
    try {
      await updateWorkspaceAiSettings(workspaceId, { handoff_keywords: next });
      await qc.invalidateQueries({ queryKey: ["workspace-ai-settings", workspaceId] });
      toast.success(message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to save handover phrases");
    } finally {
      setSaving(false);
    }
  };

  const add = () => {
    const k = draft.replace(/\s+/g, " ").trim();
    if (k.length < 2 || k.length > 60) return toast.error("Use 2 to 60 characters.");
    if (keywords.some((x) => x.toLowerCase() === k.toLowerCase())) return toast.error("That phrase is already on the list.");
    if (keywords.length >= MAX) return toast.error(`You can add up to ${MAX} phrases.`);
    setDraft("");
    void save([...keywords, k], `“${k}” now hands chats to your team`);
  };

  return (
    <Card className={className}>
      <CardHeader><CardTitle className="text-base">Human handover</CardTitle></CardHeader>
      <CardContent className="space-y-3 pt-0">
        <p className="text-sm text-muted-foreground">
          The AI hands a chat to your team when the customer asks for a person (for example “can I speak to someone”, “call me back”), when it cannot help, or when an automation asks it to.
          Add phrases specific to your business, such as <span className="font-medium text-foreground">refund</span> or <span className="font-medium text-foreground">complaint</span>.
        </p>
        <div className="flex flex-wrap gap-1.5" aria-label="Handover phrases">
          {keywords.length === 0 ? <span className="text-xs text-muted-foreground">No extra phrases yet. The built-in detection is always on.</span> : null}
          {keywords.map((k) => (
            <span key={k} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs">
              {k}
              {canManage ? (
                <button type="button" disabled={saving} aria-label={`Remove ${k}`} className="text-muted-foreground hover:text-foreground"
                  onClick={() => void save(keywords.filter((x) => x !== k), `Removed “${k}”`)}>
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </span>
          ))}
        </div>
        {canManage ? (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={60} placeholder="Add a phrase, e.g. refund" aria-label="New handover phrase" className="max-w-xs" />
            <Button type="submit" size="sm" variant="outline" disabled={saving || draft.trim().length < 2}>Add</Button>
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">Only workspace owners and admins can change this.</p>
        )}
        <p className="text-xs text-muted-foreground">Matches whole words and phrases, in any letter case. While a person handles a chat, AI never replies automatically.</p>
      </CardContent>
    </Card>
  );
}

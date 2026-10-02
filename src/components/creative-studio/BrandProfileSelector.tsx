import { useEffect, useState } from "react";
import { Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { BrandProfileEditor } from "@/components/creative-studio/BrandProfileEditor";
import { listBrandProfiles, seedDefaultProfileIfMissing, type BrandProfile } from "@/lib/brandProfiles";

type Props = {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  selectedProfileId: string | null;
  onSelect: (profile: BrandProfile | null) => void;
};

// "Choose Brand / Company" (instruction #4) - the top control of the
// one-click Creative Studio form. Selecting a profile immediately
// populates the advert's branding; Edit/+New brand manage profiles
// in-place without leaving Creative Studio (instruction #24).
export function BrandProfileSelector({ workspaceId, workspaceName, userId, selectedProfileId, onSelect }: Props) {
  const [profiles, setProfiles] = useState<BrandProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<BrandProfile | null>(null);

  async function reload(preferId?: string) {
    const list = await listBrandProfiles(workspaceId);
    setProfiles(list);
    const preferredId = preferId ?? selectedProfileId ?? undefined;
    const preferred = preferredId ? list.find((p) => p.id === preferredId) : undefined;
    const fallback = list.find((p) => p.isDefault) ?? list[0] ?? null;
    onSelect(preferred ?? fallback);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      let list = await listBrandProfiles(workspaceId);
      if (list.length === 0) {
        const seeded = await seedDefaultProfileIfMissing(workspaceId, workspaceName);
        if (seeded) list = [seeded];
      }
      if (cancelled) return;
      setProfiles(list);
      const linked = selectedProfileId ? list.find((p) => p.id === selectedProfileId) : undefined;
      onSelect(linked ?? list.find((p) => p.isDefault) ?? list[0] ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const selected = profiles.find((p) => p.id === selectedProfileId) ?? null;

  return (
    <div className="space-y-1.5">
      <Label>Brand / Company</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={selectedProfileId ?? ""}
          onValueChange={(id) => onSelect(profiles.find((p) => p.id === id) ?? null)}
          disabled={loading}
        >
          <SelectTrigger className="w-[240px]">
            <SelectValue placeholder={loading ? "Loading brands..." : "Choose a brand"} />
          </SelectTrigger>
          <SelectContent>
            {profiles.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
                {p.isDefault ? " (default)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!selected}
          onClick={() => {
            setEditingProfile(selected);
            setEditorOpen(true);
          }}
        >
          <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Edit
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setEditingProfile(null);
            setEditorOpen(true);
          }}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" /> New brand
        </Button>
      </div>

      <BrandProfileEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        workspaceId={workspaceId}
        userId={userId}
        profile={editingProfile}
        onSaved={(saved) => reload(saved.id)}
      />
    </div>
  );
}

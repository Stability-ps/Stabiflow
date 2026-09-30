import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { WidgetLayoutEntry } from "@/hooks/useDashboardPreferences";
import type { PresetId } from "@/lib/dashboard/types";
import { getWidgetDefinition, PRESET_LABELS, type WidgetAvailabilityFilter } from "@/lib/dashboard/widgetRegistry";
import { applyPreset, moveItem, resolveLayout } from "@/lib/dashboard/dashboardLayout";

export function DashboardCustomizer({ open, onOpenChange, availableIds, filter, initialLayout, initialPreset, onSave, isSaving }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableIds: Set<string>;
  filter: WidgetAvailabilityFilter;
  initialLayout: WidgetLayoutEntry[];
  initialPreset: PresetId | null;
  onSave: (layout: WidgetLayoutEntry[], preset: PresetId | null) => void;
  isSaving: boolean;
}) {
  const [layout, setLayout] = useState<WidgetLayoutEntry[]>(initialLayout);
  const [preset, setPreset] = useState<PresetId | null>(initialPreset);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Re-seed local state each time the dialog opens - editing then
  // cancelling must never leak into the next open.
  useEffect(() => {
    if (open) {
      setLayout(initialLayout);
      setPreset(initialPreset);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const visible = layout.filter((w) => w.visible);

  function toggleVisible(id: string) {
    setLayout((prev) => prev.map((w) => (w.id === id ? { ...w, visible: !w.visible } : w)));
    setPreset(null);
  }

  function reorderVisible(fromId: string, toId: string) {
    if (fromId === toId) return;
    setLayout((prev) => {
      const visibleIds = prev.filter((w) => w.visible).map((w) => w.id);
      const from = visibleIds.indexOf(fromId);
      const to = visibleIds.indexOf(toId);
      const reorderedVisibleIds = moveItem(visibleIds, from, to);
      const hidden = prev.filter((w) => !w.visible);
      const byId = new Map(prev.map((w) => [w.id, w]));
      return [...reorderedVisibleIds.map((id) => byId.get(id)!), ...hidden];
    });
    setPreset(null);
  }

  function moveVisible(id: string, direction: -1 | 1) {
    const ids = visible.map((w) => w.id);
    const index = ids.indexOf(id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    reorderVisible(id, ids[target]);
  }

  function handleApplyPreset(p: PresetId) {
    setLayout(applyPreset(p, filter, availableIds));
    setPreset(p);
  }

  function handleReset() {
    setLayout(resolveLayout(null, availableIds));
    setPreset(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Customize your dashboard</DialogTitle>
          <DialogDescription>Choose what shows on your Home dashboard and the order it appears in.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <p className="text-sm font-medium">Start from a preset</p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(PRESET_LABELS) as PresetId[]).map((p) => (
              <Button key={p} type="button" size="sm" variant={preset === p ? "default" : "outline"} onClick={() => handleApplyPreset(p)}>
                {PRESET_LABELS[p]}
              </Button>
            ))}
            <Button type="button" size="sm" variant={preset === null ? "default" : "outline"} disabled>
              Custom
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Show on dashboard</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {layout.map((w) => {
              const def = getWidgetDefinition(w.id);
              if (!def) return null;
              return (
                <Label key={w.id} className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm font-normal">
                  <Checkbox checked={w.visible} onCheckedChange={() => toggleVisible(w.id)} />
                  {def.label}
                </Label>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Rearrange</p>
          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing selected above yet.</p>
          ) : (
            <ul className="space-y-1">
              {visible.map((w, i) => {
                const def = getWidgetDefinition(w.id);
                if (!def) return null;
                return (
                  <li
                    key={w.id}
                    draggable
                    onDragStart={() => setDragIndex(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragIndex !== null) reorderVisible(visible[dragIndex].id, w.id);
                      setDragIndex(null);
                    }}
                    className={cn("flex items-center gap-2 rounded-md border bg-card p-2 text-sm", dragIndex === i && "opacity-50")}
                  >
                    <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden="true" />
                    <span className="flex-1">{def.label}</span>
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={i === 0} aria-label={`Move ${def.label} up`} onClick={() => moveVisible(w.id, -1)}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={i === visible.length - 1} aria-label={`Move ${def.label} down`} onClick={() => moveVisible(w.id, 1)}>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between sm:justify-between">
          <Button type="button" variant="ghost" onClick={handleReset}>Reset to recommended</Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="button" onClick={() => onSave(layout, preset)} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save dashboard"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

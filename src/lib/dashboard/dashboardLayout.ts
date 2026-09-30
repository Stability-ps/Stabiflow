import type { WidgetLayoutEntry } from "@/hooks/useDashboardPreferences";
import { DEFAULT_WIDGET_ORDER, widgetsForPreset, type WidgetAvailabilityFilter } from "@/lib/dashboard/widgetRegistry";
import type { PresetId } from "@/lib/dashboard/types";

/** Merges a saved layout with what's actually available right now (module
 * flags/permissions can change): keeps the user's saved order and
 * visibility for ids still available, drops ids that are no longer
 * available, and appends any registry widget the user has never seen as
 * hidden - a newly-enabled module never silently appears on someone's
 * dashboard uninvited. A brand-new user (no saved layout) gets the default
 * order, all visible. */
export function resolveLayout(saved: WidgetLayoutEntry[] | null | undefined, availableIds: Set<string>): WidgetLayoutEntry[] {
  if (!saved || saved.length === 0) {
    return DEFAULT_WIDGET_ORDER.filter((id) => availableIds.has(id)).map((id) => ({ id, visible: true }));
  }
  const savedIds = new Set(saved.map((w) => w.id));
  const kept = saved.filter((w) => availableIds.has(w.id));
  const appended = DEFAULT_WIDGET_ORDER.filter((id) => availableIds.has(id) && !savedIds.has(id)).map((id) => ({ id, visible: false }));
  return [...kept, ...appended];
}

/** A preset is a starting layout, not a permanent mode: widgets in the
 * preset go to the front and visible; everything else available stays in
 * the list (so the customizer can still show/reorder it) but hidden. */
export function applyPreset(preset: PresetId, filter: WidgetAvailabilityFilter, availableIds: Set<string>): WidgetLayoutEntry[] {
  const presetIds = widgetsForPreset(preset, filter);
  const presetSet = new Set(presetIds);
  const rest = DEFAULT_WIDGET_ORDER.filter((id) => availableIds.has(id) && !presetSet.has(id));
  return [...presetIds.map((id) => ({ id, visible: true })), ...rest.map((id) => ({ id, visible: false }))];
}

export function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const copy = [...items];
  const [moved] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, moved);
  return copy;
}

import { getWidgetDefinition } from "@/lib/dashboard/widgetRegistry";
import type { WidgetSize } from "@/lib/dashboard/types";
import { DashboardWidgetFrame } from "@/components/dashboard/DashboardWidgetFrame";
import { cn } from "@/lib/utils";

const SIZE_CLASSES: Record<WidgetSize, string> = {
  sm: "sm:col-span-1 lg:col-span-2",
  md: "sm:col-span-2 lg:col-span-3",
  lg: "sm:col-span-2 lg:col-span-4",
  full: "col-span-full",
};

/** Desktop: 6-column grid, each widget spans according to its size.
 * Tablet: 2 columns. Phone: always single column - nobody manually
 * resizes anything to make the dashboard usable on a small screen. */
export function DashboardGrid({ widgetIds }: { widgetIds: string[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
      {widgetIds.map((id) => {
        const def = getWidgetDefinition(id);
        if (!def) return null;
        const Component = def.component;
        return (
          <div key={id} className={cn(SIZE_CLASSES[def.defaultSize])}>
            <DashboardWidgetFrame label={def.label}>
              <Component />
            </DashboardWidgetFrame>
          </div>
        );
      })}
    </div>
  );
}

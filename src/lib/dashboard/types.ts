import type { ComponentType } from "react";
import type { FeatureFlagKey } from "@/lib/featureFlags";
import type { WorkspacePermission } from "@/lib/permissions";

export type WidgetSize = "sm" | "md" | "lg" | "full";

export type PresetId = "business_owner" | "sales" | "marketing";

export type WidgetDefinition = {
  id: string;
  label: string;
  description: string;
  category: "metric" | "chart" | "list" | "activity";
  defaultSize: WidgetSize;
  /** Hidden entirely (registry + customizer + grid) unless this flag is on. */
  flag?: FeatureFlagKey;
  /** Hidden unless the viewer holds this permission (e.g. revenue is not
   * shown to a role without revenue.view, regardless of what they enabled
   * in the customizer - the customizer only controls layout, never access). */
  permission?: WorkspacePermission;
  presets: PresetId[];
  component: ComponentType;
};

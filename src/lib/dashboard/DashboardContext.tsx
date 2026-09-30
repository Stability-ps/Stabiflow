import { createContext, useContext, type ReactNode } from "react";
import type { DateRange } from "@/lib/analyticsDate";
import type { WorkspacePermission } from "@/lib/permissions";
import type { FeatureFlagKey } from "@/lib/featureFlags";

export type DashboardContextValue = {
  workspaceId: string;
  range: DateRange;
  previousRange: DateRange;
  timezone: string;
  currency: string;
  hasPermission: (permission: WorkspacePermission) => boolean;
  isEnabled: (flag: FeatureFlagKey) => boolean;
  metaConnected: boolean;
  whatsappConnected: boolean;
};

const DashboardCtx = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({ value, children }: { value: DashboardContextValue; children: ReactNode }) {
  return <DashboardCtx.Provider value={value}>{children}</DashboardCtx.Provider>;
}

/** Every widget component reads its shared inputs (workspace, date range,
 * permissions) from here instead of prop-drilling - each widget still runs
 * its own React Query call for its own data, this just avoids every one of
 * them re-deriving the same range/timezone/permission plumbing Overview
 * used to compute once at the top of one giant component. */
export function useDashboardContext(): DashboardContextValue {
  const ctx = useContext(DashboardCtx);
  if (!ctx) throw new Error("useDashboardContext must be used within a DashboardProvider");
  return ctx;
}

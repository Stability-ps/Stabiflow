import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Settings2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceTimezone } from "@/hooks/useWorkspaceTimezone";
import { useWorkspaceCurrency } from "@/hooks/useWorkspaceCurrency";
import { useWorkspaceIntegrations } from "@/hooks/useIntegrations";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { useDashboardPreferences, useSaveDashboardPreferences, type WidgetLayoutEntry } from "@/hooks/useDashboardPreferences";
import { Button } from "@/components/ui/button";
import { OnboardingChecklist } from "@/components/dashboard/OnboardingChecklist";
import { DashboardGrid } from "@/components/dashboard/DashboardGrid";
import { DashboardCustomizer } from "@/components/dashboard/DashboardCustomizer";
import { computeOnboardingItems, onboardingProgress } from "@/lib/onboarding";
import { previousComparisonRange, resolveDateRangePreset } from "@/lib/analyticsDate";
import { hasCurrentIntegration } from "@/lib/dashboardPresentation";
import { DashboardProvider } from "@/lib/dashboard/DashboardContext";
import { availableWidgets } from "@/lib/dashboard/widgetRegistry";
import { resolveLayout } from "@/lib/dashboard/dashboardLayout";
import type { PresetId } from "@/lib/dashboard/types";

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// Home is a thin shell: it resolves the shared inputs every widget needs
// (workspace, date range, permissions, feature flags) once, hands them to
// DashboardProvider, and renders whichever widgets the user's saved
// layout says to show, in their chosen order. Individual widget behavior
// (what data it fetches, its own loading/empty/error states) lives in
// src/components/dashboard/widgets/*, not here.
export default function Overview() {
  const { currentMembership, currentWorkspaceId, user, profile, hasPermission } = useAuth();
  const { isEnabled } = useFeatureFlags();
  const timezone = useWorkspaceTimezone(currentWorkspaceId);
  const currency = useWorkspaceCurrency(currentWorkspaceId);
  const [now] = useState(() => new Date());
  const range = useMemo(() => resolveDateRangePreset("last_30_days", timezone, now), [timezone, now]);
  const previousRange = useMemo(() => previousComparisonRange(range), [range]);

  const integrationsQuery = useWorkspaceIntegrations(currentWorkspaceId);
  const integrations = integrationsQuery.data || [];
  const metaConnected = hasCurrentIntegration(integrations, "meta");
  const whatsappConnected = hasCurrentIntegration(integrations, "whatsapp");

  const onboardingStatusQuery = useOnboardingStatus(currentWorkspaceId);
  const onboardingComplete = useMemo(() => {
    if (!onboardingStatusQuery.data) return false;
    const items = computeOnboardingItems(onboardingStatusQuery.data);
    const { completed, total } = onboardingProgress(items);
    return completed === total;
  }, [onboardingStatusQuery.data]);
  const hasRealActivity = !!onboardingStatusQuery.data && (
    onboardingStatusQuery.data.conversations > 0 ||
    onboardingStatusQuery.data.leadsOrOpportunities > 0 ||
    onboardingStatusQuery.data.campaigns > 0
  );
  const showOnboardingFirst = !onboardingComplete && !hasRealActivity;

  const availableIds = useMemo(
    () => new Set(availableWidgets({ isEnabled, hasPermission }).map((w) => w.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isEnabled, hasPermission],
  );
  const prefsQuery = useDashboardPreferences(currentWorkspaceId, user?.id ?? null);
  const saveMutation = useSaveDashboardPreferences(currentWorkspaceId, user?.id ?? null);
  const layout = useMemo(() => resolveLayout(prefsQuery.data?.widgets, availableIds), [prefsQuery.data, availableIds]);
  const visibleIds = layout.filter((w) => w.visible).map((w) => w.id);

  const [customizerOpen, setCustomizerOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if ((location.state as { openDashboardCustomizer?: boolean } | null)?.openDashboardCustomizer) {
      setCustomizerOpen(true);
      // Consume the one-shot navigation state so back/forward or a refresh
      // doesn't reopen the dialog unexpectedly.
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSave(newLayout: WidgetLayoutEntry[], preset: PresetId | null) {
    saveMutation.mutate({ widgets: newLayout, preset }, { onSuccess: () => setCustomizerOpen(false) });
  }

  if (!currentWorkspaceId) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{greeting(now)}{profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}</h1>
          <p className="text-sm text-muted-foreground">{currentMembership?.workspace.name ?? "Your workspace"}</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setCustomizerOpen(true)}>
          <Settings2 className="h-4 w-4" />
          Customize dashboard
        </Button>
      </div>

      {showOnboardingFirst && <OnboardingChecklist workspaceId={currentWorkspaceId} />}

      <DashboardProvider
        value={{
          workspaceId: currentWorkspaceId,
          range,
          previousRange,
          timezone,
          currency,
          hasPermission,
          isEnabled,
          metaConnected,
          whatsappConnected,
        }}
      >
        <DashboardGrid widgetIds={visibleIds} />
      </DashboardProvider>

      {!showOnboardingFirst && <OnboardingChecklist workspaceId={currentWorkspaceId} />}

      <DashboardCustomizer
        open={customizerOpen}
        onOpenChange={setCustomizerOpen}
        availableIds={availableIds}
        filter={{ isEnabled, hasPermission }}
        initialLayout={layout}
        initialPreset={prefsQuery.data?.preset ?? null}
        onSave={handleSave}
        isSaving={saveMutation.isPending}
      />
    </div>
  );
}

import { Outlet, useLocation } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { AppHeader } from "@/components/layout/AppHeader";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { WorkspaceStatusBanner } from "@/components/layout/WorkspaceStatusBanner";
import { PlatformNotice } from "@/components/layout/PlatformNotice";
import { LegalReconsentBanner } from "@/components/layout/LegalReconsentBanner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { filterNavItems } from "@/lib/featureFlags";
import { NAV_ITEMS } from "@/lib/navigation";
import { useMobileKeyboard } from "@/hooks/useMobileKeyboard";

export function AppLayout() {
  const location = useLocation();
  const { isEnabled } = useFeatureFlags();
  const navItems = filterNavItems(NAV_ITEMS, isEnabled);
  useMobileKeyboard();

  return (
    <SidebarProvider>
      <AppSidebar items={navItems} />
      <div className="flex min-h-dvh w-full min-w-0 flex-col bg-gradient-to-br from-background via-background to-sky-50/30">
        <AppHeader />
        <PlatformNotice />
        <LegalReconsentBanner />
        <WorkspaceStatusBanner />
        {/* Phones: bottom padding clears the fixed bottom navigation
            (--bottom-nav-height is 0 from md up, so desktop is unchanged).
            overflow-x-clip (not auto) keeps position:sticky working. */}
        <main className="flex-1 overflow-x-clip p-4 pb-[calc(var(--bottom-nav-height)+1.5rem)] sm:p-6 sm:pb-[calc(var(--bottom-nav-height)+1.5rem)] md:overflow-auto md:px-7 md:py-7 md:pb-7">
          {/* Keyed by pathname so a crash on one route doesn't linger
              when navigating to another - the boundary remounts fresh. */}
          <ErrorBoundary key={location.pathname} label={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <MobileBottomNav items={navItems} />
    </SidebarProvider>
  );
}

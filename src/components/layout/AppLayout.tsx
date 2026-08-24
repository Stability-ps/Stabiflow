import { Outlet, useLocation } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { AppHeader } from "@/components/layout/AppHeader";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export function AppLayout() {
  const location = useLocation();

  return (
    <SidebarProvider>
      <AppSidebar />
      <div className="flex min-h-screen w-full min-w-0 flex-col">
        <AppHeader />
        <main className="flex-1 overflow-auto p-4 sm:p-6">
          {/* Keyed by pathname so a crash on one route doesn't linger
              when navigating to another - the boundary remounts fresh. */}
          <ErrorBoundary key={location.pathname} label={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </SidebarProvider>
  );
}

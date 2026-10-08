// The admin shell: a fixed (never scrolling, never animating) sidebar on
// desktop, a drawer on tablet/mobile, a sticky header with global search,
// and the role reported by the server. Authorization is enforced by the
// admin edge functions; this shell only decides what to show.
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, LogOut, Menu, Search, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { CommandPalette } from "@/components/admin/CommandPalette";
import { visibleNav } from "@/components/admin/adminNav";
import { ErrorState } from "@/components/admin/AdminPrimitives";
import { AdminContext, useAdmin } from "@/hooks/useAdmin";
import { useAuth } from "@/hooks/useAuth";
import { adminConsole, AdminApiError, type AdminMe } from "@/lib/adminApi";
import { ROLE_LABELS } from "@/lib/adminPermissions";
import { cn } from "@/lib/utils";

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { permissions } = useAdmin();
  return (
    <nav aria-label="Admin" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {visibleNav(permissions).map((section) => (
        <div key={section.label}>
          <p className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{section.label}</p>
          <ul className="space-y-0.5">
            {section.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === "/admin"}
                  onClick={onNavigate}
                  className={({ isActive }) => cn(
                    "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-foreground/80 hover:bg-sidebar-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive && "bg-sidebar-accent font-medium text-foreground",
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <Link to="/admin" onClick={onNavigate} aria-label="StabiFlow admin home" className="flex items-center gap-2">
          <BrandLogo variant="full" className="h-7 w-auto" />
        </Link>
        <Badge variant="secondary" className="ml-auto text-[10px]">Admin</Badge>
      </div>
      <SidebarNav onNavigate={onNavigate} />
      <div className="space-y-1 border-t px-4 py-3 text-xs text-muted-foreground">
        <Link to="/app" className="flex items-center gap-1.5 hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />Back to StabiFlow</Link>
        <p>Build {__APP_COMMIT__} · {__APP_ENV__}</p>
      </div>
    </div>
  );
}

function Shell() {
  const { role } = useAdmin();
  const { profile, user, signOut } = useAuth();
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.title = "StabiFlow Admin";
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r bg-sidebar lg:block">
        <SidebarBody />
      </aside>
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Admin navigation</SheetTitle>
          <SidebarBody onNavigate={() => setDrawer(false)} />
        </SheetContent>
      </Sheet>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setDrawer(true)} aria-label="Open navigation">
            <Menu className="h-5 w-5" />
          </Button>
          <button
            type="button"
            onClick={() => setPalette(true)}
            className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border bg-card px-3 text-sm text-muted-foreground hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-md"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="truncate">Search users, businesses, payments…</span>
            <kbd className="ml-auto hidden rounded border bg-muted px-1.5 text-[10px] font-medium sm:inline">⌘K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden text-right leading-tight md:block">
              <p className="text-sm font-medium">{profile?.full_name || user?.email}</p>
              <p className="text-xs text-muted-foreground">{ROLE_LABELS[role].label}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => void signOut()} aria-label="Sign out"><LogOut className="h-4 w-4" /></Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
      <CommandPalette open={palette} onOpenChange={setPalette} />
    </div>
  );
}

/** Asks the server who the caller is. A non-staff account sees Access
 * Denied - never the admin UI. */
export function AdminLayout() {
  const me = useQuery({
    queryKey: ["admin-me"],
    queryFn: () => adminConsole<AdminMe>("me"),
    retry: (count, err) => !(err instanceof AdminApiError && (err.status === 401 || err.status === 403)) && count < 2,
    staleTime: 60_000,
  });

  if (me.isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading admin" /></div>;
  }
  if (me.error instanceof AdminApiError && (me.error.status === 401 || me.error.status === 403)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
        <ShieldAlert className="h-8 w-8 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Access denied</h1>
        <p className="max-w-sm text-sm text-muted-foreground">This area is for the StabiFlow operating team. Your account does not have a staff role.</p>
        <Button asChild variant="outline"><Link to="/app">Back to StabiFlow</Link></Button>
      </div>
    );
  }
  if (me.error || !me.data) {
    return <div className="mx-auto max-w-lg px-4 py-24"><ErrorState error={me.error} onRetry={() => void me.refetch()} /></div>;
  }
  return (
    <AdminContext.Provider value={me.data}>
      <TooltipProvider delayDuration={150}>
        <Shell />
      </TooltipProvider>
    </AdminContext.Provider>
  );
}

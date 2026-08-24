import { Bell } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { WorkspaceSwitcher } from "@/components/layout/WorkspaceSwitcher";
import { UserMenu } from "@/components/layout/UserMenu";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <SidebarTrigger />
      <div className="flex-1" />
      <WorkspaceSwitcher />
      {/* Notification placeholder - no real notification system yet; kept
          visually present (per the header spec) without pretending to
          have unread data by inventing a count. */}
      <Button variant="ghost" size="icon" aria-label="Notifications" disabled className="text-muted-foreground">
        <Bell className="h-4 w-4" />
      </Button>
      <UserMenu />
    </header>
  );
}

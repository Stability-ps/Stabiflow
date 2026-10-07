import { Link, useLocation } from "react-router-dom";
import { CircleHelp, Lock, Shield } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarSeparator,
} from "@/components/ui/sidebar";
import { WorkspaceSwitcher } from "@/components/layout/WorkspaceSwitcher";
import { CommandMenu } from "@/components/layout/CommandMenu";
import { GUIDE_PATH, isNavItemActive, NAV_ITEMS, NAV_SECTIONS, type NavItem } from "@/lib/navigation";
import { MODULE_LOCK_INFO } from "@/lib/moduleLockInfo";
import { useAdminAccess } from "@/hooks/useAdminAccess";

// Figma "Nav Item": 32px rows; the current page is a raised white row with a
// hairline ring and a blue icon (no colour flood). Plan-locked modules stay
// visible with a lock and lead to their existing upgrade screen.
const ITEM =
  "h-8 gap-2.5 rounded-lg px-2 text-[13px] font-medium text-sidebar-foreground transition-colors duration-fast " +
  "hover:bg-accent hover:text-foreground " +
  "data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:text-foreground data-[active=true]:shadow-xs data-[active=true]:ring-1 data-[active=true]:ring-sidebar-border " +
  "[&>svg]:size-4 [&[data-active=true]>svg]:text-primary";

const UTILITY_PATHS = ["/app/billing", "/app/settings"];

function NavRow({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isNavItemActive(item.path, pathname);
  const to = item.path === "/app/whatsapp" ? "/app/whatsapp/inbox" : item.path;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={item.label} className={ITEM}>
        <Link to={to} aria-current={active ? "page" : undefined}>
          <item.icon aria-hidden="true" />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function LockedRow({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isNavItemActive(item.path, pathname);
  const plans = item.flag ? MODULE_LOCK_INFO[item.flag]?.plans : undefined;
  const explanation = plans ? `Included in the ${plans}` : "Not included in your current plan";
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={`${item.label} - locked. ${explanation}`}
        className={`${ITEM} [&>svg:first-child]:text-locked`}
      >
        <Link
          to={item.path}
          aria-current={active ? "page" : undefined}
          aria-label={`${item.label} (locked). ${explanation}. View upgrade options`}
          title={`${explanation}. View upgrade options`}
          data-locked="true"
        >
          <item.icon aria-hidden="true" />
          <span className="flex-1">{item.label}</span>
          <Lock className="!size-3.5 shrink-0 text-locked" aria-hidden="true" />
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function FooterLink({ to, label, icon: Icon, pathname }: { to: string; label: string; icon: LucideIcon; pathname: string }) {
  const active = pathname === to || pathname.startsWith(`${to}/`);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={label} className={ITEM}>
        <Link to={to} aria-current={active ? "page" : undefined}>
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

// `items` is the feature-flag filtered list and `lockedItems` the plan-locked
// modules (both from AppLayout), so this component stays presentational.
export function AppSidebar({ items = NAV_ITEMS, lockedItems = [] }: { items?: NavItem[]; lockedItems?: NavItem[] }) {
  const { pathname } = useLocation();
  const canOpenAdmin = useAdminAccess();
  const byPath = new Map(items.map((i) => [i.path, i]));
  const lockedByPath = new Map(lockedItems.map((i) => [i.path, i]));
  const sectioned = new Set(NAV_SECTIONS.flatMap((s) => s.paths));
  const home = byPath.get("/app");
  const utility = UTILITY_PATHS.map((p) => byPath.get(p)).filter((i): i is NavItem => !!i);
  // Anything not in a section or the footer (future items) still renders.
  const loose = items.filter((i) => i.path !== "/app" && !sectioned.has(i.path) && !UTILITY_PATHS.includes(i.path));

  return (
    <Sidebar collapsible="icon" aria-label="StabiFlow navigation">
      <SidebarHeader className="gap-2 px-3 pb-2 pt-3">
        <WorkspaceSwitcher />
        <CommandMenu items={items} lockedItems={lockedItems} canOpenAdmin={canOpenAdmin} />
      </SidebarHeader>

      <SidebarContent className="gap-0 px-3 pb-2">
        <nav aria-label="Primary">
          {home || loose.length > 0 ? (
            <SidebarGroup className="px-0 py-1">
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {home ? <NavRow item={home} pathname={pathname} /> : null}
                  {loose.map((item) => <NavRow key={item.path} item={item} pathname={pathname} />)}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ) : null}

          {NAV_SECTIONS.map((section) => {
            const rows = section.paths
              .map((p) => ({ item: byPath.get(p) ?? lockedByPath.get(p), locked: !byPath.has(p) }))
              .filter((r): r is { item: NavItem; locked: boolean } => !!r.item);
            if (rows.length === 0) return null;
            const labelId = `sidebar-section-${section.key}`;
            return (
              <SidebarGroup key={section.key} className="px-0 py-0.5" role="group" aria-labelledby={labelId}>
                <SidebarGroupLabel id={labelId} className="h-7 px-2 pt-1.5 text-overline uppercase text-subtle-foreground">
                  {section.label}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu className="gap-0.5">
                    {rows.map(({ item, locked }) =>
                      locked ? <LockedRow key={item.path} item={item} pathname={pathname} /> : <NavRow key={item.path} item={item} pathname={pathname} />,
                    )}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            );
          })}
        </nav>
      </SidebarContent>

      <SidebarSeparator className="mx-3 w-auto" />
      <SidebarFooter className="px-3 pb-3 pt-1">
        <SidebarMenu className="gap-0.5">
          <FooterLink to={GUIDE_PATH} label="Guide" icon={CircleHelp} pathname={pathname} />
          {utility.map((item) => <NavRow key={item.path} item={item} pathname={pathname} />)}
          {canOpenAdmin ? <FooterLink to="/admin" label="Admin console" icon={Shield} pathname={pathname} /> : null}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

import { Link, NavLink, useLocation } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { isNavChildActive, isNavItemActive, NAV_ITEMS, type NavItem } from "@/lib/navigation";

// `items` defaults to the full list; AppLayout passes the feature-flag
// filtered list (see filterNavItems) so this component stays a pure
// presentational list.
export function AppSidebar({ items = NAV_ITEMS }: { items?: NavItem[] }) {
  const { pathname } = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  // The mobile sidebar is a Sheet whose open state lives in SidebarProvider,
  // which stays mounted across route changes - without this, picking a
  // destination on a phone left the menu covering the new page.
  const closeMobileMenu = () => { if (isMobile) setOpenMobile(false); };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        {/* BrandLogo's "full" variant is already the complete icon+wordmark
            lockup - rendering the standalone icon next to it duplicated
            the mark. Show exactly one brand presentation at a time: the
            full lockup when expanded, the icon alone when collapsed. */}
        <NavLink to="/app" onClick={closeMobileMenu} className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
          <BrandLogo variant="icon" className="hidden h-7 w-7 shrink-0 group-data-[collapsible=icon]:block" />
          <BrandLogo variant="full" className="h-7 w-auto group-data-[collapsible=icon]:hidden" />
        </NavLink>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const active = isNavItemActive(item, pathname);
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton asChild tooltip={item.label} isActive={active}>
                      {/* A plain Link, not NavLink: `active` already accounts for
                          child routes keeping a group selected (e.g. /app/customers
                          under Business), which NavLink's own to-vs-pathname
                          matching can't know about - and NavLink silently drops
                          an explicitly-passed aria-current when its own matching
                          disagrees, so it can't be used here. */}
                      <Link
                        to={item.path}
                        onClick={closeMobileMenu}
                        aria-current={active ? "page" : undefined}
                        className={active ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium [&_svg]:text-sidebar-accent-foreground" : ""}
                      >
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {item.children && active && (
                      <SidebarMenuSub aria-label={`${item.label} sections`}>
                        {item.children.map((child) => {
                          const childActive = isNavChildActive(child, pathname);
                          return (
                            <SidebarMenuSubItem key={child.to}>
                              <SidebarMenuSubButton asChild isActive={childActive}>
                                <NavLink
                                  to={child.to}
                                  onClick={closeMobileMenu}
                                  aria-current={childActive ? "page" : undefined}
                                  aria-label={`${item.label} ${child.label}`}
                                  title={child.external ? `Open ${child.label}, filtered to ${item.label}` : undefined}
                                >
                                  <span>{child.label}</span>
                                  {child.external && <span aria-hidden="true" className="ml-auto text-xs opacity-60">&#8599;</span>}
                                </NavLink>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          );
                        })}
                      </SidebarMenuSub>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="px-3 py-3 text-xs text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden">
        Create. Advertise. Connect. Convert.
      </SidebarFooter>
    </Sidebar>
  );
}

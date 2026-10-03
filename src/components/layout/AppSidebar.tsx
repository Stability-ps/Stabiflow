import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { isNavItemActive, NAV_ITEMS, type NavChild, type NavItem } from "@/lib/navigation";
import { useAuth } from "@/hooks/useAuth";
import { fetchBillingState } from "@/lib/billing";

function isChildActive(child: NavChild, pathname: string): boolean {
  if (child.external) return false;
  const childPath = child.to.split("?")[0];
  return pathname === childPath || pathname.startsWith(`${childPath}/`);
}

type DesktopSection = {
  key: string;
  label: string;
  paths: string[];
};

const DESKTOP_SECTIONS: DesktopSection[] = [
  {
    key: "business",
    label: "Business",
    paths: ["/app/business", "/app/business-studio", "/app/documents"],
  },
  {
    key: "marketing",
    label: "Marketing",
    paths: ["/app/creative-studio", "/app/content", "/app/campaigns"],
  },
  {
    key: "customers",
    label: "Customers",
    paths: ["/app/whatsapp", "/app/leads", "/app/customers"],
  },
  {
    key: "automations",
    label: "Automations",
    paths: ["/app/automations", "/app/integrations"],
  },
  {
    key: "insights",
    label: "Insights",
    paths: ["/app/analytics", "/app/flow-ai"],
  },
];

function sectionContainsPath(section: DesktopSection, pathname: string) {
  return section.paths.some((path) => isNavItemActive(path, pathname));
}

function navItemByPath(items: NavItem[], path: string) {
  return items.find((item) => item.path === path);
}

// `items` defaults to the full list; AppLayout passes the feature-flag
// filtered list (see filterNavItems) so this component stays presentational.
export function AppSidebar({ items = NAV_ITEMS }: { items?: NavItem[] }) {
  const { pathname } = useLocation();
  const { currentMembership, currentWorkspaceId } = useAuth();
  const billingState = useQuery({
    queryKey: ["sidebar-billing-state", currentWorkspaceId],
    queryFn: () => fetchBillingState(currentWorkspaceId as string),
    enabled: !!currentWorkspaceId,
    staleTime: 5 * 60_000,
  });
  const planName = billingState.data?.subscription?.plan?.name ?? billingState.data?.purchases?.[0]?.plan?.name ?? "Free";
  const workspaceName = currentMembership?.workspace.name ?? "Workspace";

  const groupedSections = useMemo(
    () =>
      DESKTOP_SECTIONS.map((section) => ({
        ...section,
        items: section.paths
          .map((path) => navItemByPath(items, path))
          .filter((item): item is NavItem => Boolean(item)),
      })).filter((section) => section.items.length > 0),
    [items],
  );

  const groupedPaths = useMemo(
    () => new Set(DESKTOP_SECTIONS.flatMap((section) => section.paths)),
    [],
  );

  const directItems = useMemo(
    () => items.filter((item) => !groupedPaths.has(item.path)),
    [groupedPaths, items],
  );

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  function sectionOpen(section: DesktopSection) {
    return openSections[section.key] ?? sectionContainsPath(section, pathname);
  }

  function toggleSection(key: string, currentlyOpen: boolean) {
    setOpenSections((current) => ({ ...current, [key]: !currentlyOpen }));
  }

  function renderMessagesChildren(item: NavItem) {
    if (!item.children || !isNavItemActive(item.path, pathname)) return null;

    return (
      <SidebarMenuSub
        aria-label={`${item.label} sections`}
        className="ml-8 mt-1 border-sidebar-border/60 pl-3"
      >
        {item.children.map((child) => {
          const childActive = isChildActive(child, pathname);
          return (
            <SidebarMenuSubItem key={child.to}>
              <SidebarMenuSubButton
                asChild
                isActive={childActive}
                className="h-8 rounded-lg text-[13px] text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:text-sidebar-accent-foreground"
              >
                <NavLink
                  to={child.to}
                  aria-current={childActive ? "page" : undefined}
                  aria-label={`${item.label} ${child.label}`}
                  title={child.external ? `Open ${child.label}, filtered to ${item.label}` : undefined}
                >
                  <span>{child.label}</span>
                  {child.external && (
                    <span aria-hidden="true" className="ml-auto text-xs opacity-50">
                      &#8599;
                    </span>
                  )}
                </NavLink>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          );
        })}
      </SidebarMenuSub>
    );
  }

  function renderDirectItem(item: NavItem) {
    const active = isNavItemActive(item.path, pathname);

    return (
      <SidebarMenuItem key={item.path}>
        <SidebarMenuButton
          asChild
          tooltip={item.label}
          isActive={active}
          className="h-11 rounded-xl px-2.5 text-[15px] font-medium transition-all duration-200 hover:bg-sidebar-accent/70 hover:shadow-sm data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:shadow-sm"
        >
          <NavLink
            to={item.path}
            end={item.path === "/app"}
            aria-current={active ? "page" : undefined}
            className="gap-3"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sidebar-border/70 bg-background/80 shadow-sm [&_svg]:h-[17px] [&_svg]:w-[17px]">
              <item.icon />
            </span>
            <span>{item.label}</span>
          </NavLink>
        </SidebarMenuButton>
        {renderMessagesChildren(item)}
      </SidebarMenuItem>
    );
  }

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border/70">
      <SidebarHeader className="px-3 pb-3 pt-5">
        <NavLink
          to="/app"
          className="flex items-center rounded-xl px-1 transition-opacity hover:opacity-90 group-data-[collapsible=icon]:justify-center"
          aria-label="StabiFlow home"
        >
          <BrandLogo
            variant="icon"
            className="hidden h-9 w-9 shrink-0 group-data-[collapsible=icon]:block"
          />
          <BrandLogo
            variant="full"
            className="h-9 w-auto group-data-[collapsible=icon]:hidden"
          />
        </NavLink>
      </SidebarHeader>

      <SidebarContent className="px-2 pb-3">
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu className="gap-1.5">
              {directItems
                .filter((item) => item.path === "/app")
                .map(renderDirectItem)}

              {groupedSections.map((section) => {
                const open = sectionOpen(section);
                const active = sectionContainsPath(section, pathname);
                const SectionIcon = section.items[0].icon;

                return (
                  <SidebarMenuItem key={section.key}>
                    <SidebarMenuButton
                      type="button"
                      tooltip={section.label}
                      isActive={active}
                      onClick={() => toggleSection(section.key, open)}
                      aria-expanded={open}
                      aria-controls={`desktop-nav-${section.key}`}
                      className="h-11 rounded-xl px-2.5 text-[15px] font-medium transition-all duration-200 hover:bg-sidebar-accent/70 hover:shadow-sm data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:shadow-sm"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sidebar-border/70 bg-background/80 shadow-sm [&_svg]:h-[17px] [&_svg]:w-[17px]">
                        <SectionIcon />
                      </span>
                      <span>{section.label}</span>
                      <ChevronRight
                        aria-hidden="true"
                        className={`ml-auto h-4 w-4 text-sidebar-foreground/50 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
                      />
                    </SidebarMenuButton>

                    {open && (
                      <SidebarMenuSub
                        id={`desktop-nav-${section.key}`}
                        aria-label={`${section.label} navigation`}
                        className="ml-4 mt-1.5 border-sidebar-border/60 pl-3"
                      >
                        {section.items.map((item) => {
                          const itemActive = isNavItemActive(item.path, pathname);
                          return (
                            <SidebarMenuSubItem key={item.path}>
                              <SidebarMenuSubButton
                                asChild
                                isActive={itemActive}
                                className="min-h-9 rounded-lg px-2.5 text-[13.5px] text-sidebar-foreground/75 transition-all hover:bg-sidebar-accent/70 hover:text-sidebar-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:text-sidebar-accent-foreground"
                              >
                                <NavLink
                                  to={item.path}
                                  aria-current={itemActive ? "page" : undefined}
                                  className="gap-2.5"
                                >
                                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sidebar-accent/70 [&_svg]:h-3.5 [&_svg]:w-3.5">
                                    <item.icon />
                                  </span>
                                  <span>{item.label}</span>
                                </NavLink>
                              </SidebarMenuSubButton>
                              {renderMessagesChildren(item)}
                            </SidebarMenuSubItem>
                          );
                        })}
                      </SidebarMenuSub>
                    )}
                  </SidebarMenuItem>
                );
              })}

              {directItems
                .filter((item) => item.path !== "/app")
                .map(renderDirectItem)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="px-3 pb-4 pt-2 group-data-[collapsible=icon]:hidden">
        <div className="rounded-xl border border-sidebar-border/70 bg-sidebar-accent/40 px-3 py-2.5 shadow-sm">
          <NavLink to="/app/billing" className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-semibold text-sidebar-foreground">{workspaceName}</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/40" />
            </div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-sidebar-foreground/60">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]" />
              <span className="truncate">{billingState.isLoading ? "Checking plan..." : `${planName} plan`}</span>
            </div>
          </NavLink>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

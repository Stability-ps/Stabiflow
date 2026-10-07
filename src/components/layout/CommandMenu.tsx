import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CircleHelp, CornerDownLeft, Lock, Search, Shield } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog, DialogPortal } from "@/components/ui/dialog";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import type { NavItem } from "@/lib/navigation";
import { buildDestinations, filterDestinations, type Destination } from "@/lib/commandDestinations";
import { cn } from "@/lib/utils";

/**
 * "Search or jump to…" - sidebar trigger plus a keyboard-first dialog
 * (Cmd/Ctrl+K). Locked modules are listed and open their upgrade screen.
 */
export function CommandMenu({ items, lockedItems, canOpenAdmin }: { items: NavItem[]; lockedItems: NavItem[]; canOpenAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const listId = useId();
  const all = useMemo(() => buildDestinations(items, lockedItems, canOpenAdmin), [items, lockedItems, canOpenAdmin]);
  const results = useMemo(() => filterDestinations(all, query), [all, query]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery("");
      setActive(0);
    }
  };

  const go = (d: Destination | undefined) => {
    if (!d) return;
    changeOpen(false);
    navigate(d.to);
  };

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[active]);
    }
  };

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            onClick={() => changeOpen(true)}
            tooltip="Search or jump to…"
            aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
            className="h-8 border border-sidebar-border bg-card text-muted-foreground shadow-xs hover:bg-card hover:text-foreground group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:shadow-none"
          >
            <Search aria-hidden="true" />
            <span className="flex-1 truncate">Search or jump to…</span>
            <kbd className="ml-auto hidden rounded border border-sidebar-border px-1 font-sans text-[11px] text-subtle-foreground lg:inline">{isMac ? "⌘K" : "Ctrl K"}</kbd>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>

      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogPortal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[hsl(220_26%_9%/0.35)] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border bg-card shadow-lg focus:outline-none"
            aria-describedby={undefined}
          >
            <DialogPrimitive.Title className="sr-only">Search or jump to</DialogPrimitive.Title>
            <div className="flex items-center gap-2 border-b px-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                autoFocus
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                onKeyDown={onInputKey}
                placeholder="Search pages and settings…"
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
                aria-label="Search pages and settings"
                className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <ul id={listId} role="listbox" aria-label="Destinations" className="max-h-[50vh] overflow-y-auto p-1.5">
              {results.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">No pages match “{query}”.</li>
              ) : (
                results.map((d, i) => {
                  const showGroup = i === 0 || results[i - 1].group !== d.group;
                  return (
                    <li key={d.key} role="presentation">
                      {showGroup ? <p className="px-2.5 pb-1 pt-2 text-overline uppercase text-muted-foreground">{d.group}</p> : null}
                      <div
                        id={`${listId}-${i}`}
                        role="option"
                        aria-selected={i === active}
                        onMouseMove={() => setActive(i)}
                        onClick={() => go(d)}
                        className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm", i === active ? "bg-accent text-foreground" : "text-foreground/90")}
                      >
                        {d.group === "Help" ? <CircleHelp className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> : d.group === "Staff" ? <Shield className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> : <ArrowRight className="h-4 w-4 text-subtle-foreground" aria-hidden="true" />}
                        <span className="min-w-0 flex-1 truncate">{d.label}</span>
                        {d.locked ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Lock className="h-3 w-3" aria-hidden="true" /> Locked · {d.locked}
                          </span>
                        ) : i === active ? (
                          <CornerDownLeft className="h-3.5 w-3.5 text-subtle-foreground" aria-hidden="true" />
                        ) : null}
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>
    </>
  );
}

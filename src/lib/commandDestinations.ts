import { GUIDE_PATH, navSectionFor, SUB_DESTINATIONS, type NavItem } from "@/lib/navigation";
import { MODULE_LOCK_INFO } from "@/lib/moduleLockInfo";

// Destinations for the shell's "Search or jump to…" menu (CommandMenu).
export type Destination = { key: string; label: string; group: string; to: string; locked?: string; keywords?: string };

/** Everything reachable from the shell, in sidebar order. */
export function buildDestinations(items: NavItem[], lockedItems: NavItem[], canOpenAdmin: boolean): Destination[] {
  const out: Destination[] = [];
  for (const item of items) {
    const group = navSectionFor(item.path)?.label ?? "General";
    out.push({ key: item.path, label: item.label, group, to: item.path === "/app/whatsapp" ? "/app/whatsapp/inbox" : item.path });
    for (const sub of SUB_DESTINATIONS.filter((d) => d.parent === item.path)) {
      out.push({ key: sub.to, label: `${item.label} › ${sub.label}`, group, to: sub.to, keywords: sub.label });
    }
  }
  for (const item of lockedItems) {
    const info = item.flag ? MODULE_LOCK_INFO[item.flag] : undefined;
    out.push({ key: item.path, label: item.label, group: navSectionFor(item.path)?.label ?? "General", to: item.path, locked: info?.plans ?? "a higher plan" });
  }
  out.push({ key: GUIDE_PATH, label: "Guide", group: "Help", to: GUIDE_PATH, keywords: "help how-to docs" });
  if (canOpenAdmin) out.push({ key: "/admin", label: "Admin console", group: "Staff", to: "/admin", keywords: "operator" });
  return out;
}

export function filterDestinations(all: Destination[], query: string): Destination[] {
  const q = query.trim().toLowerCase();
  if (!q) return all;
  return all.filter((d) => `${d.label} ${d.group} ${d.keywords ?? ""}`.toLowerCase().includes(q));
}

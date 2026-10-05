// Global admin search + navigation (Ctrl/⌘ K). Search results are filtered
// server-side by role. Commands only navigate - nothing destructive runs
// from here.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Building2, CornerDownLeft, CreditCard, Loader2, Receipt, Search, User } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { adminConsole, type SearchResults } from "@/lib/adminApi";
import { formatMoney } from "@/lib/adminFormat";
import { visibleNav } from "@/components/admin/adminNav";
import { useAdmin } from "@/hooks/useAdmin";
import { cn } from "@/lib/utils";

type Item = { key: string; group: string; label: string; hint?: string; to: string; icon: typeof Search };

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { permissions } = useAdmin();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const dq = useDebounced(q.trim(), 200);

  const search = useQuery({
    queryKey: ["admin-search", dq],
    queryFn: () => adminConsole<SearchResults>("search", { q: dq }),
    enabled: open && dq.length >= 2,
    staleTime: 30_000,
  });

  const items = useMemo<Item[]>(() => {
    const needle = q.trim().toLowerCase();
    const pages: Item[] = visibleNav(permissions).flatMap((s) => s.items)
      .filter((i) => !needle || `${i.label} ${i.keywords ?? ""}`.toLowerCase().includes(needle))
      .slice(0, needle ? 6 : 20)
      .map((i) => ({ key: `nav:${i.to}`, group: "Go to", label: i.label, to: i.to, icon: i.icon }));
    const r = dq.length >= 2 ? search.data : undefined;
    const found: Item[] = r ? [
      ...r.users.map((u) => ({ key: `u:${u.id}`, group: "Users", label: u.full_name || u.email, hint: u.full_name ? u.email : undefined, to: `/admin/users/${u.id}`, icon: User })),
      ...r.workspaces.map((w) => ({ key: `w:${w.id}`, group: "Businesses", label: w.name, hint: w.slug, to: `/admin/businesses/${w.id}`, icon: Building2 })),
      ...r.transactions.map((t) => ({ key: `t:${t.id}`, group: "Transactions", label: t.reference, hint: `${formatMoney(t.amount_minor, t.currency)} · ${t.status}${t.workspace_name ? ` · ${t.workspace_name}` : ""}`, to: `/admin/transactions?q=${encodeURIComponent(t.reference)}`, icon: Receipt })),
      ...r.subscriptions.map((s) => ({ key: `s:${s.id}`, group: "Subscriptions", label: s.workspace_name ?? s.id.slice(0, 8), hint: `${s.status}${s.provider_subscription_code ? ` · ${s.provider_subscription_code}` : ""}`, to: `/admin/businesses/${s.workspace_id}`, icon: CreditCard })),
    ] : [];
    return [...found, ...pages];
  }, [q, dq, search.data, permissions]);

  function go(item: Item | undefined) {
    if (!item) return;
    onOpenChange(false);
    setQ("");
    navigate(item.to);
  }

  const groups = items.reduce<Record<string, Item[]>>((acc, i) => ((acc[i.group] ??= []).push(i), acc), {});
  let index = -1;

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setQ(""); }}>
      <DialogContent className="top-[12%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Search StabiFlow admin</DialogTitle>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setCursor(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, items.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
              if (e.key === "Enter") { e.preventDefault(); go(items[cursor]); }
            }}
            placeholder="Search users, businesses, payment references, or jump to a page…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            role="combobox"
            aria-expanded="true"
            aria-controls="admin-cmdk-list"
            aria-activedescendant={items[cursor] ? `cmdk-${items[cursor].key}` : undefined}
          />
          {search.isFetching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </div>
        <div id="admin-cmdk-list" role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
          {dq.length >= 2 && search.isError ? <p className="px-2 py-3 text-sm text-destructive">Search failed. Try again.</p> : null}
          {items.length === 0 ? <p className="px-2 py-6 text-center text-sm text-muted-foreground">No matches.</p> : null}
          {Object.entries(groups).map(([group, list]) => (
            <div key={group} className="mb-2">
              <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{group}</p>
              {list.map((item) => {
                index += 1;
                const i = index;
                const Icon = item.icon;
                return (
                  <button
                    type="button"
                    key={item.key}
                    id={`cmdk-${item.key}`}
                    role="option"
                    aria-selected={i === cursor}
                    onMouseMove={() => setCursor(i)}
                    onClick={() => go(item)}
                    className={cn("flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm", i === cursor && "bg-accent")}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{item.label}{item.hint ? <span className="ml-2 text-xs text-muted-foreground">{item.hint}</span> : null}</span>
                    {i === cursor ? <CornerDownLeft className="h-3.5 w-3.5 text-muted-foreground" /> : null}
                  </button>
                );
              })}
            </div>
          ))}
          {q.trim().length === 1 ? <p className="px-2 pb-2 text-xs text-muted-foreground">Type at least 2 characters to search records.</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

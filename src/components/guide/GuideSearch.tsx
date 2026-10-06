import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { chapterPath, highlightParts, searchGuide } from "@/content/guide";
import { cn } from "@/lib/utils";

function Highlighted({ text, query }: { text: string; query: string }) {
  return <>{highlightParts(text, query).map((p, i) => (p.match ? <mark key={i} className="rounded-sm bg-primary/15 text-foreground">{p.text}</mark> : <span key={i}>{p.text}</span>))}</>;
}

function isTypingTarget(el: EventTarget | null) {
  return el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

/** Client-side search across every chapter, section, step, FAQ and troubleshooting entry. */
export function GuideSearch({ className, autoFocus }: { className?: string; autoFocus?: boolean }) {
  const navigate = useNavigate();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useMemo(() => searchGuide(query), [query]);

  // "/" jumps to search from anywhere in the guide.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(index: number) {
    const r = results[index];
    if (!r) return;
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    navigate(chapterPath(r.chapterSlug, r.sectionId));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); go(active); }
    else if (e.key === "Escape") { if (query) setQuery(""); else inputRef.current?.blur(); setOpen(false); }
  }

  const showList = open && query.trim().length > 0;

  return (
    <div className={cn("guide-no-print relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
        aria-label="Search the guide"
        placeholder="Search the guide"
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        className="h-11 rounded-xl pl-9 pr-16 [&::-webkit-search-cancel-button]:hidden"
      />
      {query ? (
        <button type="button" onClick={() => { setQuery(""); inputRef.current?.focus(); }} className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent" aria-label="Clear search">
          <X className="h-4 w-4" />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 text-[11px] text-muted-foreground sm:block">/</kbd>
      )}
      {showList && (
        <div id={listId} role="listbox" aria-label="Search results" className="absolute inset-x-0 top-full z-30 mt-2 max-h-[min(70vh,28rem)] overflow-y-auto rounded-xl border bg-popover p-1.5 shadow-lg">
          {results.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">No results for "{query.trim()}". Try a simpler word, or browse the chapters.</p>
          ) : results.map((r, i) => (
            <div
              key={`${r.chapterSlug}-${r.sectionId}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); go(i); }}
              onMouseEnter={() => setActive(i)}
              className={cn("cursor-pointer rounded-lg px-3 py-2.5", i === active && "bg-accent")}
            >
              <p className="text-xs text-muted-foreground">{r.chapterTitle}</p>
              <p className="text-sm font-medium"><Highlighted text={r.sectionTitle} query={query} /></p>
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground"><Highlighted text={r.snippet} query={query} /></p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

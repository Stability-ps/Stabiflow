import { useCallback, useSyncExternalStore } from "react";
import { useAuth } from "@/hooks/useAuth";

// Guide reading progress, per user, on this device. Deliberately local: it's
// a personal convenience, never a source of truth, so a cleared browser just
// starts the checklist again. One shared in-memory store keeps every
// component (sidebar ticks, chapter button, home progress) in step.
const key = (userId: string) => `stabiflow.guide.read.${userId}`;
const EMPTY: ReadonlySet<string> = new Set();
const cache = new Map<string, ReadonlySet<string>>();
const listeners = new Set<() => void>();

function load(userId: string): ReadonlySet<string> {
  const cached = cache.get(userId);
  if (cached) return cached;
  let value: ReadonlySet<string> = EMPTY;
  try {
    const raw = localStorage.getItem(key(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) value = new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch { /* storage unavailable or corrupt - start empty */ }
  cache.set(userId, value);
  return value;
}

function save(userId: string, value: ReadonlySet<string>) {
  cache.set(userId, value);
  try { localStorage.setItem(key(userId), JSON.stringify([...value])); } catch { /* keep in memory only */ }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useGuideProgress() {
  const { user } = useAuth();
  const userId = user?.id;
  const read = useSyncExternalStore(subscribe, () => (userId ? load(userId) : EMPTY), () => EMPTY);

  const setChapterRead = useCallback((slug: string, value: boolean) => {
    if (!userId) return;
    const next = new Set(load(userId));
    if (value) next.add(slug); else next.delete(slug);
    save(userId, next);
  }, [userId]);

  return { read, isRead: (slug: string) => read.has(slug), setChapterRead };
}

/** Test helper: forget cached progress between tests. */
export function resetGuideProgressCache() {
  cache.clear();
}

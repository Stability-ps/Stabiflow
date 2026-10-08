import { useEffect, useSyncExternalStore } from "react";

// Light / Dark / System for the signed-in app (/app). Public pages (landing,
// pricing, a business's public profile) always stay light. The choice is a
// per-browser preference, so it lives in localStorage; index.html applies it
// before first paint to avoid a light flash on /app.
export type ThemePreference = "light" | "dark" | "system";
export const THEME_STORAGE_KEY = "stabiflow-theme";

const listeners = new Set<() => void>();

function read(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === "dark" || v === "system" ? v : "light";
  } catch {
    return "light";
  }
}

let current: ThemePreference = typeof window === "undefined" ? "light" : read();

export function getThemePreference(): ThemePreference {
  return current;
}

export function setThemePreference(next: ThemePreference) {
  current = next;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // private mode etc. - the choice still applies for this session
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function systemPrefersDark() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(pref: ThemePreference, prefersDark = systemPrefersDark()): "light" | "dark" {
  return pref === "system" ? (prefersDark ? "dark" : "light") : pref;
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, getThemePreference, () => "light");
}

/**
 * Applies the preference to <html> while mounted (AppLayout only) and follows
 * the OS setting live for "system". Unmounting - leaving /app for a public
 * page - restores light.
 */
export function useApplyTheme() {
  const pref = useThemePreference();
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const apply = () => root.classList.toggle("dark", resolveTheme(pref, !!media?.matches) === "dark");
    apply();
    media?.addEventListener?.("change", apply);
    return () => {
      media?.removeEventListener?.("change", apply);
      root.classList.remove("dark");
    };
  }, [pref]);
}

function subscribeHtmlClass(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/** What is actually applied right now - light on public pages whatever the preference. */
export function useAppliedTheme(): "light" | "dark" {
  return useSyncExternalStore(
    subscribeHtmlClass,
    () => (document.documentElement.classList.contains("dark") ? "dark" : "light"),
    () => "light",
  );
}

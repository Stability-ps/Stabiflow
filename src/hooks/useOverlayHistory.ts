import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const MARK = "__sfOverlay";
let instances = 0;

/**
 * Makes a mobile overlay (drawer / bottom sheet / phone dialog) behave like a
 * native one:
 *
 * - Opening pushes a history entry (same URL), so the device/browser Back
 *   button closes the overlay instead of leaving the page.
 * - Closing any other way (backdrop, Escape, close button) pops that entry
 *   again, so no dead "back" step is left behind.
 * - `navigateFrom(to)` closes the overlay and navigates by REPLACING the
 *   overlay entry - exactly one history step per navigation, no stale entry,
 *   no double navigation.
 * - Any route change that happens while open (e.g. a link rendered inside the
 *   overlay) closes it automatically.
 *
 * history.back() is asynchronous, so a close followed immediately by a
 * reopen races it. To stay correct whether the browser runs or drops that
 * pending back, a reopen never pushes while one is in flight - it adopts the
 * overlay entry that is still current - and the popstate our own back()
 * produces is recognised (`pendingBack`) and never treated as the user
 * pressing Back: a stale event cannot close the NEW overlay.
 *
 * Each pushed entry carries a generation token unique to this overlay, so an
 * entry left behind by something else (another overlay, or a reload while an
 * overlay entry was current) is never mistaken for this overlay's own.
 */
export function useOverlayHistoryEntry(open: boolean, onClose: () => void) {
  const pushed = useRef(false);
  const [instance] = useState(() => ++instances);
  const generation = useRef(0);
  /** Token of the entry this overlay currently owns. */
  const token = useRef<string | null>(null);
  const pendingBack = useRef(false);
  const isOpen = useRef(open);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  const currentMark = () => (window.history.state as Record<string, unknown> | null)?.[MARK] ?? null;
  const pushEntry = useCallback(() => {
    token.current = `${instance}:${++generation.current}`;
    // Keep the router's own state (key/idx) so popping back to the previous
    // entry is a no-op for React Router.
    window.history.pushState({ ...(window.history.state ?? {}), [MARK]: token.current }, "");
    pushed.current = true;
  }, [instance]);

  // One listener for the lifetime of the hook (no per-open listeners).
  useEffect(() => {
    const onPop = () => {
      const onOverlayEntry = !!token.current && currentMark() === token.current;
      if (pendingBack.current) {
        // Our own history.back() from an earlier close - never a user Back,
        // wherever it landed. If the overlay was reopened meanwhile, make sure
        // it owns a history entry again.
        pendingBack.current = false;
        if (isOpen.current) {
          if (onOverlayEntry) pushed.current = true;
          else pushEntry();
        }
        return;
      }
      if (onOverlayEntry) {
        // Back on this overlay's own entry (e.g. Forward): it still owns it.
        if (isOpen.current) pushed.current = true;
        return;
      }
      if (!pushed.current) return;
      pushed.current = false;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [pushEntry]);

  useEffect(() => {
    isOpen.current = open;
    if (!open) {
      if (pushed.current) {
        pushed.current = false;
        if (currentMark() === token.current) {
          pendingBack.current = true;
          window.history.back();
        }
      }
      return;
    }
    if (pushed.current) return;
    if (pendingBack.current) {
      // Reopened while our previous back() is still in flight: adopt the
      // overlay entry that is still current (never push during a pending
      // traversal); the listener restores an entry if the back then lands.
      if (token.current && currentMark() === token.current) pushed.current = true;
      return;
    }
    pushEntry();
  }, [open, pushEntry]);

  /**
   * Hand this overlay's history entry over to the caller (e.g. to navigate
   * with replace). Returns true when the overlay owned an entry.
   */
  const release = useCallback(() => {
    const owned = pushed.current;
    pushed.current = false;
    return owned;
  }, []);

  return { release, onCloseRef };
}

/**
 * useOverlayHistoryEntry + React Router: closes the overlay when the route
 * changes underneath it, and `navigateFrom(to)` replaces the overlay's entry.
 */
export function useOverlayHistory(open: boolean, onClose: () => void) {
  const navigate = useNavigate();
  const location = useLocation();
  const { release, onCloseRef } = useOverlayHistoryEntry(open, onClose);

  // Route changed underneath an open overlay: the entry is gone/replaced, so
  // just close (never history.back(), which would undo the navigation).
  const lastPath = useRef(`${location.pathname}${location.search}`);
  useEffect(() => {
    const current = `${location.pathname}${location.search}`;
    if (current === lastPath.current) return;
    lastPath.current = current;
    if (open) {
      release();
      onCloseRef.current();
    }
  }, [location.pathname, location.search, open, release, onCloseRef]);

  const navigateFrom = useCallback(
    (to: string) => {
      if (release()) navigate(to, { replace: true });
      else navigate(to);
      onCloseRef.current();
    },
    [navigate, release, onCloseRef],
  );

  return { navigateFrom };
}

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const MARK = "__sfOverlay";

/**
 * Makes a mobile overlay (drawer / bottom sheet) behave like a native one:
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
 */
export function useOverlayHistory(open: boolean, onClose: () => void) {
  const navigate = useNavigate();
  const location = useLocation();
  const pushed = useRef(false);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) {
      if (pushed.current) {
        pushed.current = false;
        if ((window.history.state as Record<string, unknown> | null)?.[MARK]) window.history.back();
      }
      return;
    }
    // Keep the router's own state (key/idx) so popping back to the previous
    // entry is a no-op for React Router.
    window.history.pushState({ ...(window.history.state ?? {}), [MARK]: true }, "");
    pushed.current = true;
    const onPop = () => {
      if (!pushed.current) return;
      pushed.current = false;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [open]);

  // Route changed underneath an open overlay: the entry is gone/replaced, so
  // just close (never history.back(), which would undo the navigation).
  const lastPath = useRef(`${location.pathname}${location.search}`);
  useEffect(() => {
    const current = `${location.pathname}${location.search}`;
    if (current === lastPath.current) return;
    lastPath.current = current;
    if (open) {
      pushed.current = false;
      onCloseRef.current();
    }
  }, [location.pathname, location.search, open]);

  const navigateFrom = useCallback(
    (to: string) => {
      if (pushed.current) {
        pushed.current = false;
        navigate(to, { replace: true });
      } else {
        navigate(to);
      }
      onCloseRef.current();
    },
    [navigate],
  );

  return { navigateFrom };
}

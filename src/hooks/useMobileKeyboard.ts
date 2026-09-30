import { useEffect } from "react";

const EDITABLE = "input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]), textarea, select, [contenteditable=true]";

/**
 * Phone on-screen keyboard handling for the app shell:
 * - flags <html data-keyboard-open> while the keyboard covers the layout
 *   viewport (the bottom nav hides itself via CSS), and
 * - keeps the focused field visible once the keyboard has finished opening
 *   (Android resizes late; iOS overlays the keyboard).
 * No-op on devices without a VisualViewport or a coarse pointer.
 */
export function useMobileKeyboard() {
  useEffect(() => {
    const vv = window.visualViewport;
    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    if (!vv || !coarse) return;
    const root = document.documentElement;

    const update = () => {
      const open = window.innerHeight - vv.height > 150;
      if (open) root.setAttribute("data-keyboard-open", "");
      else root.removeAttribute("data-keyboard-open");
    };
    let timer: number | undefined;
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el?.matches?.(EDITABLE)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (document.activeElement === el) el.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 300);
    };

    vv.addEventListener("resize", update);
    document.addEventListener("focusin", onFocusIn);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      document.removeEventListener("focusin", onFocusIn);
      window.clearTimeout(timer);
      root.removeAttribute("data-keyboard-open");
    };
  }, []);
}

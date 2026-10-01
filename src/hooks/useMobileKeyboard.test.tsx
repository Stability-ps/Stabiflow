// Finding 4: while the on-screen keyboard is open, phone bottom sheets must
// sit above it. useMobileKeyboard publishes the visible viewport as CSS vars
// (--vvh, --kb-inset) that DialogContent's max-sm: classes consume.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useMobileKeyboard } from "./useMobileKeyboard";

class FakeVisualViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
}

const root = document.documentElement;
let vv: FakeVisualViewport;
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  vv = new FakeVisualViewport();
  Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 800 });
  window.matchMedia = ((q: string) => ({ ...originalMatchMedia(q), matches: q === "(pointer: coarse)" })) as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
});

const kb = (height: number, offsetTop = 0) => act(() => {
  vv.height = height;
  vv.offsetTop = offsetTop;
  vv.dispatchEvent(new Event("resize"));
});

describe("useMobileKeyboard visible-viewport variables", () => {
  it("publishes --vvh and --kb-inset while the keyboard is open and clears them after", () => {
    renderHook(() => useMobileKeyboard());
    expect(root.style.getPropertyValue("--vvh")).toBe("");
    kb(460);
    expect(root.hasAttribute("data-keyboard-open")).toBe(true);
    expect(root.style.getPropertyValue("--vvh")).toBe("460px");
    expect(root.style.getPropertyValue("--kb-inset")).toBe("340px");
    kb(800);
    expect(root.hasAttribute("data-keyboard-open")).toBe(false);
    expect(root.style.getPropertyValue("--vvh")).toBe("");
    expect(root.style.getPropertyValue("--kb-inset")).toBe("");
  });

  it("accounts for iOS visual-viewport scrolling (offsetTop)", () => {
    renderHook(() => useMobileKeyboard());
    kb(460, 40);
    expect(root.style.getPropertyValue("--kb-inset")).toBe("300px");
  });

  it("is a no-op without a coarse pointer (desktop)", () => {
    window.matchMedia = ((q: string) => ({ ...originalMatchMedia(q), matches: false })) as typeof window.matchMedia;
    renderHook(() => useMobileKeyboard());
    kb(300);
    expect(root.style.getPropertyValue("--vvh")).toBe("");
    expect(root.hasAttribute("data-keyboard-open")).toBe(false);
  });

  it("cleans up on unmount", () => {
    const { unmount } = renderHook(() => useMobileKeyboard());
    kb(460);
    unmount();
    expect(root.style.getPropertyValue("--vvh")).toBe("");
    expect(root.hasAttribute("data-keyboard-open")).toBe(false);
  });
});

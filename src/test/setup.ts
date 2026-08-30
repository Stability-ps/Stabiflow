import "@testing-library/jest-dom";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

window.scrollTo = () => {};

// Radix primitives (e.g. Checkbox) call ResizeObserver, which jsdom does
// not implement.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);

// jsdom implements neither Pointer Capture nor scrollIntoView; Radix
// menu/dialog/select primitives call them. Minimal no-op shims so those
// components are testable (used by the Campaigns actions menu, etc.).
for (const method of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture", "scrollIntoView"] as const) {
  if (!(method in Element.prototype)) {
    Object.defineProperty(Element.prototype, method, { value: () => (method === "hasPointerCapture" ? false : undefined), writable: true });
  }
}

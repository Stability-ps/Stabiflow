import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { THEME_STORAGE_KEY, getThemePreference, resolveTheme, setThemePreference, useApplyTheme } from "./theme";

function Applied() {
  useApplyTheme();
  return null;
}

function mockSystemDark(dark: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: dark, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  mockSystemDark(false);
  setThemePreference("light");
  document.documentElement.classList.remove("dark");
});
afterEach(cleanup);

describe("theme", () => {
  it("resolves system against the OS preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("persists the choice", () => {
    setThemePreference("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(getThemePreference()).toBe("dark");
  });

  it("applies .dark while the app layout is mounted and removes it on leaving", () => {
    setThemePreference("dark");
    const { unmount } = render(<Applied />);
    expect(document.documentElement).toHaveClass("dark");
    unmount();
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("switching live updates <html>", () => {
    render(<Applied />);
    expect(document.documentElement).not.toHaveClass("dark");
    act(() => setThemePreference("dark"));
    expect(document.documentElement).toHaveClass("dark");
    act(() => setThemePreference("light"));
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("system follows the OS", () => {
    mockSystemDark(true);
    act(() => setThemePreference("system"));
    render(<Applied />);
    expect(document.documentElement).toHaveClass("dark");
  });
});

import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn (tailwind-merge with the design-system type scale)", () => {
  it("keeps a custom font size next to a text colour", () => {
    expect(cn("text-metric text-foreground")).toBe("text-metric text-foreground");
    expect(cn("text-title-card text-muted-foreground")).toBe("text-title-card text-muted-foreground");
  });

  it("lets a later font size replace an earlier one", () => {
    expect(cn("text-sm", "text-title-page")).toBe("text-title-page");
  });

  it("lets a caller's explicit height override the control-height token", () => {
    expect(cn("h-[var(--control-h)] px-4", "h-7")).toBe("px-4 h-7");
  });
});

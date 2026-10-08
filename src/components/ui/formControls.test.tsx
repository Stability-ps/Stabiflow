import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Input } from "./input";
import { Textarea } from "./textarea";
import { Select, SelectTrigger, SelectValue } from "./select";

// Controls sit on the card surface token (Figma bg/surface), never a hardcoded white.
describe("shared light-theme form controls", () => {
  it("uses design tokens for input and textarea backgrounds", () => {
    render(<><Input aria-label="Name" /><Textarea aria-label="Description" /></>);
    expect(screen.getByLabelText("Name")).toHaveClass("bg-card", "text-foreground");
    expect(screen.getByLabelText("Description")).toHaveClass("bg-card", "text-foreground");
    expect(screen.getByLabelText("Name")).not.toHaveClass("bg-white/92");
    expect(screen.getByLabelText("Description")).not.toHaveClass("bg-white/92");
  });

  it("keeps the shared select trigger on the same light design tokens", () => {
    render(<Select><SelectTrigger aria-label="Tone"><SelectValue placeholder="Any tone" /></SelectTrigger></Select>);
    expect(screen.getByRole("combobox", { name: "Tone" })).toHaveClass("bg-card", "text-foreground");
  });
});

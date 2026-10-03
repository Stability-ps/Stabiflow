import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BrandColorField } from "./BrandColorField";
import { HEX_COLOR_RE, isCompleteHexColor, normalizeHexColor } from "@/lib/workspaceProfile";

// Harness mirrors how WorkspaceTab/BrandProfileEditor actually drive this
// field: the parent owns `value` + computes `invalid`, the field only
// owns the picker's last-known-good colour and the blur-gated error
// display. Extracted from WorkspaceTab.tsx (window-focus/brand-kit fix
// era) so this exact shipped colour-picker UX (picker + hex, sync both
// ways, last-valid-preserved, validate-after-blur) is now shared between
// the legacy Brand Kit summary and the new Brand Profile editor.
function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  const normalized = value.trim() ? normalizeHexColor(value) : null;
  const invalid = !!value.trim() && !(normalized && HEX_COLOR_RE.test(normalized));
  return <BrandColorField id="test-color" label="Primary colour" value={value} onChange={setValue} disabled={false} placeholder="#1F2937" invalid={invalid} />;
}

function textInput() {
  return screen.getByLabelText(/^primary colour$/i);
}
function picker() {
  return screen.getByLabelText("Primary colour picker") as HTMLInputElement;
}

describe("BrandColorField - shared colour picker UX", () => {
  afterEach(() => cleanup());

  it("an unset colour renders empty with only placeholder text", () => {
    render(<Harness />);
    expect(textInput()).toHaveValue("");
    expect(textInput()).toHaveAttribute("placeholder", "#1F2937");
  });

  it("typing a valid hex updates the colour picker swatch", () => {
    render(<Harness />);
    fireEvent.change(textInput(), { target: { value: "#800080" } });
    expect(picker()).toHaveValue("#800080");
  });

  it("selecting through input[type=color] updates the text value", () => {
    render(<Harness />);
    fireEvent.change(picker(), { target: { value: "#123456" } });
    expect(textInput()).toHaveValue("#123456");
  });

  it("an incomplete typed hex does not destroy the last valid picker value", () => {
    render(<Harness initial="#1f2937" />);
    expect(picker()).toHaveValue("#1f2937");
    fireEvent.change(textInput(), { target: { value: "#80" } });
    expect(textInput()).toHaveValue("#80");
    expect(picker()).toHaveValue("#1f2937");
  });

  it("invalid hex shows inline validation only after blur (no per-keystroke nagging)", () => {
    render(<Harness />);
    const input = textInput();
    fireEvent.change(input, { target: { value: "b" } });
    expect(screen.queryByText(/use a hex colour like/i)).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "blue" } });
    fireEvent.blur(input);
    expect(screen.getByText(/use a hex colour like/i)).toBeInTheDocument();
  });

  it("isCompleteHexColor/normalizeHexColor agree on a valid short and long form", () => {
    expect(isCompleteHexColor("#1f2937")).toBe(true);
    expect(normalizeHexColor("#1F2937")).toBe("#1f2937");
    expect(isCompleteHexColor("#80")).toBe(false);
  });
});

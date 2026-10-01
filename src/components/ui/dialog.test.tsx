// Regression (PR #17 review, finding 1): the phone bottom-sheet styling used
// sm:max-h-none / sm:overflow-visible / sm:max-w-lg resets, which
// tailwind-merge cannot dedupe against a dialog's OWN max-h-* / overflow-* /
// max-w-*, so on desktop the Automation builder lost its height cap and
// scrolling (its top was pushed off-screen). Phone rules must be scoped to
// max-sm: so everything from sm up is exactly the original modal.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "./dialog";

function renderDialog(className?: string) {
  render(
    <Dialog open>
      <DialogContent className={className} aria-describedby={undefined}>
        <DialogTitle>Title</DialogTitle>
        <DialogFooter data-testid="footer"><button type="button">Save</button></DialogFooter>
      </DialogContent>
    </Dialog>,
  );
  return { content: screen.getByRole("dialog"), footer: screen.getByTestId("footer") };
}

const classes = (el: HTMLElement) => el.className.split(/\s+/);
// Every class that applies from sm up (i.e. not scoped to max-sm:).
const desktopClasses = (el: HTMLElement) => classes(el).filter((c) => !c.startsWith("max-sm:"));

describe("DialogContent desktop behaviour is unchanged by the phone bottom sheet", () => {
  afterEach(cleanup);

  it.each([
    ["Automation builder", "max-h-[85vh] max-w-2xl overflow-y-auto", ["max-h-[85vh]", "max-w-2xl", "overflow-y-auto"]],
    ["Compose post", "max-h-[90vh] max-w-lg overflow-y-auto", ["max-h-[90vh]", "max-w-lg", "overflow-y-auto"]],
    ["Brand profile editor", "max-h-[90vh] overflow-y-auto sm:max-w-xl", ["max-h-[90vh]", "overflow-y-auto", "sm:max-w-xl"]],
    ["Calendar day", "max-h-[80vh] overflow-y-auto", ["max-h-[80vh]", "overflow-y-auto"]],
  ])("%s keeps its own max-height, internal scrolling and max-width on desktop", (_name, own, expected) => {
    const { content } = renderDialog(own);
    const desktop = desktopClasses(content);
    for (const c of expected) expect(desktop).toContain(c);
    // The resets that caused the regression must be gone.
    for (const bad of ["sm:max-h-none", "sm:overflow-visible", "sm:max-w-lg"]) expect(desktop).not.toContain(bad);
    // A caller's max-w wins over the default max-w-lg (tailwind-merge) - as on main.
    if (own.includes("max-w-2xl")) expect(desktop).not.toContain("max-w-lg");
  });

  it("with no overrides, desktop classes are exactly main's centred modal", () => {
    const { content } = renderDialog();
    expect(desktopClasses(content)).toEqual(expect.arrayContaining([
      "fixed", "left-[50%]", "top-[50%]", "max-w-lg", "translate-x-[-50%]", "translate-y-[-50%]", "sm:rounded-lg", "p-6",
    ]));
  });

  it("scopes every phone bottom-sheet rule to max-sm:", () => {
    const { content } = renderDialog();
    const phone = classes(content).filter((c) => c.startsWith("max-sm:"));
    expect(phone).toEqual(expect.arrayContaining([
      "max-sm:bottom-[var(--kb-inset,0px)]", "max-sm:top-auto", "max-sm:max-w-none", "max-sm:max-h-[calc(var(--vvh,100dvh)*0.92)]", "max-sm:overflow-y-auto",
    ]));
  });
});

describe("DialogFooter on phones (finding 4)", () => {
  afterEach(cleanup);

  it("is sticky with a background on phones only, desktop layout unchanged", () => {
    const { footer } = renderDialog("max-h-[85vh] overflow-y-auto");
    const all = classes(footer);
    expect(all).toEqual(expect.arrayContaining(["max-sm:sticky", "max-sm:bg-background", "max-sm:border-t"]));
    expect(all.some((c) => c.startsWith("max-sm:pb-[max(") && c.includes("safe-area-inset-bottom"))).toBe(true);
    expect(all.filter((c) => !c.startsWith("max-sm:"))).toEqual(["flex", "flex-col-reverse", "sm:flex-row", "sm:justify-end", "sm:space-x-2"]);
  });
});

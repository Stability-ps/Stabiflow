import { describe, expect, it } from "vitest";
import { availableCreateActions, CREATE_ACTIONS } from "./createActions";

describe("availableCreateActions", () => {
  it("hides every action when no modules are enabled", () => {
    const actions = availableCreateActions(CREATE_ACTIONS, { isEnabled: () => false, hasPermission: () => true });
    expect(actions).toEqual([]);
  });

  it("hides an action the user lacks permission for, even with the module enabled", () => {
    const actions = availableCreateActions(CREATE_ACTIONS, {
      isEnabled: () => true,
      hasPermission: (p) => p !== "lead.create",
    });
    expect(actions.some((a) => a.id === "lead")).toBe(false);
    expect(actions.some((a) => a.id === "campaign")).toBe(true);
  });

  it("never exposes Invoice/Quote while module.invoicing is off, even with every permission granted", () => {
    const actions = availableCreateActions(CREATE_ACTIONS, {
      isEnabled: (f) => f !== "module.invoicing",
      hasPermission: () => true,
    });
    expect(actions.some((a) => a.id === "invoice")).toBe(false);
    expect(actions.some((a) => a.id === "quote")).toBe(false);
  });

  it("shows Invoice/Quote once module.invoicing is on (future state - unreachable today, is_enabled is a permanent kill switch)", () => {
    const actions = availableCreateActions(CREATE_ACTIONS, { isEnabled: () => true, hasPermission: () => true });
    expect(actions.some((a) => a.id === "invoice")).toBe(true);
    expect(actions.some((a) => a.id === "quote")).toBe(true);
  });

  it("never includes an action for customers or documents - no real creation flow exists for either yet", () => {
    expect(CREATE_ACTIONS.some((a) => a.id === "customer")).toBe(false);
    expect(CREATE_ACTIONS.some((a) => a.id === "document")).toBe(false);
  });
});

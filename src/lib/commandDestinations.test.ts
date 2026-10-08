import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "./navigation";
import { buildDestinations, filterDestinations } from "./commandDestinations";

const item = (label: string) => NAV_ITEMS.find((i) => i.label === label)!;

describe("jump-to destinations", () => {
  it("lists visible modules, their page tabs and the Guide; Admin only for staff", () => {
    const all = buildDestinations([item("Home"), item("Messages")], [], false);
    expect(all.map((d) => d.label)).toEqual([
      "Home", "Messages", "Messages › Inbox", "Messages › Contacts", "Messages › Templates", "Messages › Intake",
      "Messages › Analytics", "Messages › Message settings", "Guide",
    ]);
    expect(buildDestinations([], [], true).some((d) => d.to === "/admin")).toBe(true);
  });

  it("includes plan-locked modules, marked with the plan, routed to their gated page", () => {
    const [flow] = buildDestinations([], [item("Flow AI")], false);
    expect(flow).toMatchObject({ label: "Flow AI", to: "/app/flow-ai", locked: "Growth plan", group: "Insights" });
  });

  it("filters by label, section and keywords", () => {
    const all = buildDestinations(NAV_ITEMS, [], false);
    expect(filterDestinations(all, "media").map((d) => d.label)).toEqual(["Content › Media library"]);
    expect(filterDestinations(all, "insights").map((d) => d.label)).toEqual(["Analytics", "Flow AI"]);
    expect(filterDestinations(all, "  ")).toHaveLength(all.length);
  });
});

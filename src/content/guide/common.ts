import type { Availability } from "./types";

// Mirrors the production plan -> module mapping (Billing & plans page).
// Grandfathered workspaces may have extra modules switched on.
export const EVERYONE: Availability = { kind: "everyone" };
export const BUSINESS_AND_UP: Availability = { kind: "plan", plans: ["Business", "Growth"] };
export const GROWTH: Availability = { kind: "plan", plans: ["Growth"] };

export const GUIDE_UPDATED = "2026-10-07";

export const AVAILABILITY_NOTE =
  "Availability depends on your workspace plan and the modules switched on for your workspace. If you can't see this area, check Billing & plans or ask your workspace owner.";

import type { Availability } from "./types";

export function availabilityLabel(a: Availability | undefined): string | null {
  if (!a) return null;
  switch (a.kind) {
    case "everyone": return "All plans";
    case "plan": return a.plans.length > 1 ? `${a.plans.join(" and ")} plans` : `${a.plans[0]} plan`;
    case "role": return `${a.roles.join(", ")} roles`;
    case "admin": return "StabiFlow staff only";
  }
}

export function formatUpdated(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
}

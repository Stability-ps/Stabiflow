// Dashboard chart colors - validated with the dataviz skill's
// scripts/validate_palette.js against StabiFlow's actual white card
// surface (#ffffff), not the skill's generic default surface. Ink/grid/
// axis colors intentionally reuse StabiFlow's own design tokens (via CSS
// vars) instead of the skill's generic neutrals, so charts read as part
// of the same system as the rest of the app.
//
// Light-mode only: StabiFlow has no dark-mode toggle wired up yet (see
// src/components/layout/BrandLogo.tsx and src/components/ui/sonner.tsx -
// both note the same "Phase 4 branding" deferral), so there is no dark
// chart surface to validate against yet.
//
// Categorical (part-to-whole breakdowns, e.g. lead sources): fixed order,
// never cycled - a 5th real category folds into "Other" rather than
// generating a new hue. WARN on contrast vs surface for slots 3/4 is
// expected and mitigated by always rendering a direct value label.
export const CATEGORICAL_CHART_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"] as const;
export const OTHER_CATEGORY_COLOR = "hsl(var(--muted-foreground))";

// Ordinal single-hue ramp for ordered stages (the WhatsApp funnel) - one
// hue, light-to-dark, light end kept >= step 250 per the palette's ordinal
// floor so it still clears the white surface.
export const FUNNEL_STAGE_COLORS = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab"] as const;

// Plain magnitude ranking (e.g. campaign spend) - one hue, no ordering
// implied between bars.
export const MAGNITUDE_CHART_COLOR = "#2a78d6";

export const CHART_GRID_COLOR = "hsl(var(--border))";
export const CHART_AXIS_COLOR = "hsl(var(--muted-foreground))";
export const CHART_TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--popover))",
  color: "hsl(var(--popover-foreground))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "var(--radius)",
  fontSize: "0.8rem",
};

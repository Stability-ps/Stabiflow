import { describe, expect, it } from "vitest";
import { confidenceLabel, explainTouch, sourceLabel } from "./attribution";
import type { TouchSummaryRow } from "@/hooks/useAttribution";

function row(overrides: Partial<TouchSummaryRow> = {}): TouchSummaryRow {
  return {
    touch_kind: "last_touch",
    event_id: "evt-1",
    platform: "meta",
    source_type: "paid",
    source: "meta",
    occurred_at: "2026-01-01T00:00:00Z",
    campaign_id: null,
    ad_id: null,
    creative_id: null,
    attribution_confidence: "exact",
    ...overrides,
  };
}

describe("confidenceLabel", () => {
  it("never claims more precision than the underlying confidence category", () => {
    expect(confidenceLabel("exact")).toBe("Exact");
    expect(confidenceLabel("low")).toBe("Low confidence");
    expect(confidenceLabel(null)).toBe("Unknown confidence");
  });
});

describe("sourceLabel", () => {
  it("falls back to the raw source string for anything not explicitly mapped, never invents a name", () => {
    expect(sourceLabel("meta")).toBe("Meta (Facebook/Instagram) ad");
    expect(sourceLabel("some_future_provider")).toBe("some_future_provider");
    expect(sourceLabel(null)).toBe("Unknown");
  });
});

describe("explainTouch", () => {
  it("with no row at all, states plainly that there is no attribution evidence - never implies an error", () => {
    expect(explainTouch(null)).toMatch(/no attribution evidence/i);
  });

  it("a resolved paid touch with a campaign_id explains it was matched to a StabiFlow campaign", () => {
    const text = explainTouch(row({ campaign_id: "camp-1" }));
    expect(text).toMatch(/meta ad tied to a campaign/i);
    expect(text).toMatch(/exact/i);
  });

  it("a paid touch with NO campaign_id match is explained as unresolved, not silently upgraded to a campaign", () => {
    const text = explainTouch(row({ campaign_id: null, attribution_confidence: "low" }));
    expect(text).toMatch(/did not match a campaign/i);
    expect(text).toMatch(/low confidence/i);
  });

  it("a direct/organic touch is stated as confirmed organic, not merely 'unknown'", () => {
    const text = explainTouch(row({ source_type: "direct", source: "whatsapp_direct" }));
    expect(text).toMatch(/direct whatsapp message/i);
    expect(text).toMatch(/confirmed organic/i);
  });

  it("a manual override is attributed to a staff member, never presented as system-derived evidence", () => {
    const text = explainTouch(row({ platform: "manual" }));
    expect(text).toMatch(/manually assigned/i);
  });
});

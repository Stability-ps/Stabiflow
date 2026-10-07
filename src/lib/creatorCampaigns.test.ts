import { describe, expect, it } from "vitest";

// These are the same formulas surfaced by Creator Campaigns. This fixture
// locks the Starter Story example that motivated the feature.
describe("creator campaign funnel math", () => {
  it("calculates creator economics from fee -> videos -> views -> installs -> paid -> revenue", () => {
    const fee=90000, videos=30, views=600000, installs=1200, paid=120, revenue=240000;
    expect(fee/videos).toBe(3000);          // $30/video
    expect(fee/views*1000).toBe(150);      // $1.50 CPM
    expect(fee/installs).toBe(75);         // $0.75 CPI
    expect(fee/paid).toBe(750);             // $7.50 CAC
    expect(revenue/views*1000).toBe(400);   // $4.00 RPM
    expect(revenue/fee).toBeCloseTo(2.6667,3);
    expect(installs/views*100).toBeCloseTo(0.2);
    expect(paid/installs*100).toBe(10);
  });
});

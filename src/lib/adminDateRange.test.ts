import { describe, expect, it } from "vitest";
import { formatDay, parseDay, rangeParams, resolveRange } from "@/lib/adminDateRange";
import { formatCount, formatMoney, formatPercent } from "@/lib/adminFormat";

const NOW = new Date(2026, 9, 6, 14, 30); // 6 Oct 2026, local time
const r = (q: string) => resolveRange(new URLSearchParams(q), NOW);

describe("resolveRange", () => {
  it("defaults to the last 30 days including today", () => {
    const x = r("");
    expect(x.key).toBe("30d");
    expect(formatDay(x.from)).toBe("2026-09-07");
    expect(formatDay(x.to)).toBe("2026-10-07");
  });

  it("resolves calendar presets as half-open ranges", () => {
    expect([formatDay(r("range=today").from), formatDay(r("range=today").to)]).toEqual(["2026-10-06", "2026-10-07"]);
    expect([formatDay(r("range=yesterday").from), formatDay(r("range=yesterday").to)]).toEqual(["2026-10-05", "2026-10-06"]);
    expect([formatDay(r("range=last_month").from), formatDay(r("range=last_month").to)]).toEqual(["2026-09-01", "2026-10-01"]);
    expect(formatDay(r("range=this_quarter").from)).toBe("2026-10-01");
    expect(formatDay(r("range=this_year").from)).toBe("2026-01-01");
  });

  it("accepts a valid custom range and includes the end day", () => {
    const x = r("range=custom&from=2026-08-01&to=2026-08-31");
    expect(formatDay(x.from)).toBe("2026-08-01");
    expect(formatDay(x.to)).toBe("2026-09-01");
    expect(x.label).toBe("2026-08-01 – 2026-08-31");
  });

  it("falls back to the default for invalid or inverted custom ranges", () => {
    expect(r("range=custom&from=2026-08-31&to=2026-08-01").key).toBe("30d");
    expect(r("range=custom&from=2026-02-30&to=2026-03-01").key).toBe("30d");
    expect(r("range=bogus").key).toBe("30d");
  });

  it("clamps very long custom ranges to 400 days", () => {
    const x = r("range=custom&from=2020-01-01&to=2026-10-01");
    expect((x.to.getTime() - x.from.getTime()) / 86_400_000).toBeLessThanOrEqual(401);
  });

  it("carries only range params between screens", () => {
    expect(rangeParams(new URLSearchParams("range=custom&from=2026-01-01&to=2026-01-31&q=x"))).toBe("?range=custom&from=2026-01-01&to=2026-01-31");
    expect(rangeParams(new URLSearchParams("q=x"))).toBe("");
  });

  it("parses days as local dates and rejects junk", () => {
    expect(parseDay("2026-10-06")?.getDate()).toBe(6);
    expect(parseDay("06/10/2026")).toBeNull();
  });
});

describe("admin formatting", () => {
  it("never mixes currencies and keeps minor units exact", () => {
    expect(formatMoney(29900, "ZAR")).toBe("ZAR 299.00");
    expect(formatMoney(null, "ZAR")).toBe("—");
  });
  it("compacts counts and guards empty denominators", () => {
    expect(formatCount(1284)).toBe("1,284");
    expect(formatCount(12_900)).toBe("12.9K");
    expect(formatPercent(1, 0)).toBe("—");
    expect(formatPercent(1, 3)).toBe("33.3%");
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Metric, type MetricState } from "./metric";

const renderMetric = (state: MetricState, to?: string) =>
  render(<MemoryRouter><Metric label="Revenue" state={state} to={to} /></MemoryRouter>);

// 0 is data. Missing, not connected and locked are not 0.
describe("Metric five-state model", () => {
  afterEach(cleanup);

  it("value: shows the measured value", () => {
    renderMetric({ kind: "value", value: "R 48 210", note: "+12% vs last 30 days" });
    expect(screen.getByText("R 48 210")).toBeInTheDocument();
    expect(document.querySelector("[data-metric-state]")).toHaveAttribute("data-metric-state", "value");
  });

  it("zero: shows a real 0 and says it was measured", () => {
    renderMetric({ kind: "zero" });
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText(/Measured/)).toBeInTheDocument();
    // A zero must never read as missing data.
    expect(screen.queryByText(/no data|nothing recorded|not connected/i)).not.toBeInTheDocument();
    expect(document.querySelector("[data-metric-state]")).toHaveAttribute("data-metric-state", "zero");
  });

  it("no_data: never renders a 0", () => {
    renderMetric({ kind: "no_data" });
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getByText("No data")).toBeInTheDocument();
    expect(screen.getByText("No data for this period")).toBeInTheDocument();
  });

  it("not_connected: names the missing connection instead of a number", () => {
    renderMetric({ kind: "not_connected", note: "Connect Meta to track spend" }, "/app/integrations");
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/app/integrations");
  });

  it("locked: shows the plan that includes it, not a number", () => {
    renderMetric({ kind: "locked", plan: "Growth plan" }, "/app/billing");
    expect(screen.getByText("Growth plan")).toBeInTheDocument();
    expect(screen.getByText("Not included in your current plan")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});

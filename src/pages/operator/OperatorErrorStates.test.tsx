// Operator consoles: a failed load offers a retry (it used to be a dead-end
// line of red text), via the same ErrorState the Admin pages use.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const operatorAdmin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/operatorAdmin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/operatorAdmin")>("@/lib/operatorAdmin");
  return { ...actual, operatorAdmin };
});

import { OperatorUsage } from "./OperatorUsage";
import { OperatorLaunchReadiness } from "./OperatorLaunchReadiness";

function renderIt(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

afterEach(() => { cleanup(); operatorAdmin.mockReset(); });

describe("Operator error states", () => {
  it.each([["usage", <OperatorUsage key="u" />], ["launch readiness", <OperatorLaunchReadiness key="l" />]])("%s: failed load shows Retry, which refetches", async (_name, ui) => {
    operatorAdmin.mockRejectedValue(new Error("Request failed"));
    renderIt(ui);
    const retry = await screen.findByRole("button", { name: "Retry" });
    const calls = operatorAdmin.mock.calls.length;
    fireEvent.click(retry);
    await waitFor(() => expect(operatorAdmin.mock.calls.length).toBeGreaterThan(calls));
  });
});

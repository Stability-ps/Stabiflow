import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NewLeadDialog } from "./NewLeadDialog";

vi.mock("@/lib/leads", () => ({ createLeadManual: vi.fn() }));
afterEach(cleanup);

describe("NewLeadDialog defaultOpen", () => {
  it("opens immediately when defaultOpen is set", () => {
    render(<QueryClientProvider client={new QueryClient()}><NewLeadDialog workspaceId="w1" onCreated={() => {}} defaultOpen /></QueryClientProvider>);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("stays closed by default", () => {
    render(<QueryClientProvider client={new QueryClient()}><NewLeadDialog workspaceId="w1" onCreated={() => {}} /></QueryClientProvider>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

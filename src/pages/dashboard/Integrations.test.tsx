import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Integrations from "@/pages/dashboard/Integrations";
import { IntegrationInvokeError } from "@/lib/integrations";

const { startIntegrationConnectMock, toastErrorMock } = vi.hoisted(() => ({
  startIntegrationConnectMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: toastErrorMock,
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    currentWorkspaceId: "workspace-1",
    currentMembership: { role: "owner" },
  }),
}));

vi.mock("@/hooks/useIntegrations", () => ({
  useWorkspaceIntegrations: () => ({ data: [], isLoading: false }),
  useAllFacebookPages: () => ({ data: [] }),
  useAllInstagramAccounts: () => ({ data: [] }),
  useAllMetaAdAccounts: () => ({ data: [] }),
  useAllWhatsAppNumbers: () => ({ data: [] }),
}));

vi.mock("@/lib/integrations", async () => {
  const actual = await vi.importActual<typeof import("@/lib/integrations")>("@/lib/integrations");
  return {
    ...actual,
    startIntegrationConnect: startIntegrationConnectMock,
  };
});

describe("Integrations connect error messaging", () => {
  beforeEach(() => {
    startIntegrationConnectMock.mockReset();
    toastErrorMock.mockReset();
  });

  it("REGRESSION: shows the friendly meta_not_enabled message instead of Supabase generic text", async () => {
    startIntegrationConnectMock.mockRejectedValue(new IntegrationInvokeError("meta_not_enabled", "meta_not_enabled"));

    render(
      <MemoryRouter initialEntries={["/integrations"]}>
        <Integrations />
      </MemoryRouter>,
    );

    const connectButtons = screen.getAllByRole("button", { name: "Connect" });
    fireEvent.click(connectButtons[0]);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Meta production connection is not enabled yet. Contact support to enable it.",
      );
    });

    expect(toastErrorMock).not.toHaveBeenCalledWith("Edge Function returned a non-2xx status code");
  });
});
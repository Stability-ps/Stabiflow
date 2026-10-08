import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Integrations from "@/pages/dashboard/Integrations";
import { IntegrationInvokeError } from "@/lib/integrations";

const { startIntegrationConnectMock, toastErrorMock, toastSuccessMock, intState } = vi.hoisted(() => ({
  intState: { integrations: [] as Array<Record<string, unknown>>, error: false, resourcesError: false },
  startIntegrationConnectMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccessMock,
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
  useWorkspaceIntegrations: () => ({ data: intState.error ? undefined : intState.integrations, isLoading: false, isError: intState.error, refetch: vi.fn() }),
  useAllFacebookPages: () => ({ data: intState.resourcesError ? undefined : [], isError: intState.resourcesError }),
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
    toastSuccessMock.mockReset();
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

// Production regression: integrations-oauth-callback redirects the browser
// back here (now at /app/integrations) with ?integration_connected=... or
// ?integration_error=... in the query string. This page - not a blank one -
// must be what actually renders, show the right toast, and clean the query
// params off the URL so a refresh doesn't re-fire the toast.
describe("Integrations OAuth callback return handling", () => {
  beforeEach(() => {
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
  });

  it("REGRESSION: a successful Meta callback (integration_connected=meta) shows a success toast instead of a blank page", async () => {
    render(
      <MemoryRouter initialEntries={["/app/integrations?integration_connected=meta"]}>
        <Integrations />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith(
        expect.stringContaining("Meta connected"),
      );
    });
  });

  it("REGRESSION: a failed Meta callback (integration_error=access_denied) shows a friendly error toast instead of a blank page", async () => {
    render(
      <MemoryRouter initialEntries={["/app/integrations?integration_error=access_denied"]}>
        <Integrations />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "You cancelled the connection - nothing was connected.",
      );
    });
    expect(await screen.findByRole("heading", { name: "Integrations" })).toBeInTheDocument();
  });
});
describe("Integrations - honest load states", () => {
  afterEach(() => { cleanup(); intState.integrations = []; intState.error = false; intState.resourcesError = false; });

  it("a failed integrations read shows an error, never 'No integrations connected' + Connect", () => {
    intState.error = true;
    render(<MemoryRouter><Integrations /></MemoryRouter>);
    expect(screen.getByText("Couldn't load your integrations")).toBeInTheDocument();
    expect(screen.queryByText("No integrations connected")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect" })).not.toBeInTheDocument();
  });

  it("a failed resource read doesn't claim 'no Page selected' or show zero counts", () => {
    intState.integrations = [{ id: "i1", provider: "meta", status: "connected", last_health_check_status: "healthy", last_health_check_at: null }];
    intState.resourcesError = true;
    render(<MemoryRouter><Integrations /></MemoryRouter>);
    expect(screen.getByText("Couldn't load connected resources")).toBeInTheDocument();
    expect(screen.queryByText(/no Page selected/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Facebook Pages: 0/)).not.toBeInTheDocument();
  });

  it("a connected integration shows its status as a labelled pill", () => {
    intState.integrations = [{ id: "i1", provider: "meta", status: "connected", last_health_check_status: "reauthorization_required", last_health_check_at: null }];
    render(<MemoryRouter><Integrations /></MemoryRouter>);
    expect(screen.getByText("Reauthorization required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { LegalDocumentPage } from "./LegalDocumentPage";

const fetchPublishedLegal = vi.fn();
vi.mock("@/lib/legal", async (orig) => ({
  ...(await orig<typeof import("@/lib/legal")>()),
  fetchPublishedLegal: (t: string) => fetchPublishedLegal(t),
  fetchLegalHistory: vi.fn().mockResolvedValue([
    { version: "2026-10-15", effective_at: "2026-10-15T00:00:00Z", published_at: "2026-10-14T00:00:00Z", status: "published" },
    { version: "2026-08-28", effective_at: "2026-08-28T00:00:00Z", published_at: "2026-08-27T00:00:00Z", status: "superseded" },
  ]),
}));

function renderPage(fallback?: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LegalDocumentPage type="terms_of_service" fallback={fallback} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LegalDocumentPage", () => {
  afterEach(() => {
    cleanup();
    fetchPublishedLegal.mockReset();
  });

  it("keeps the built-in page until the owner publishes a version", async () => {
    fetchPublishedLegal.mockResolvedValue(null);
    renderPage(<p>Built-in terms</p>);
    await waitFor(() => expect(screen.getByText("Built-in terms")).toBeInTheDocument());
  });

  it("renders the published version with its version, effective date and history - as text, not HTML", async () => {
    fetchPublishedLegal.mockResolvedValue({
      id: "1", document_type: "terms_of_service", version: "2026-10-15", title: "Terms of Service",
      body: "## Payments\nPay via **Paystack**. <img src=x onerror=alert(1)>", effective_at: "2026-10-15T00:00:00Z", published_at: null,
    });
    const { container } = renderPage(<p>Built-in terms</p>);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Payments" })).toBeInTheDocument());
    expect(screen.getByText(/version 2026-10-15/)).toBeInTheDocument();
    expect(screen.getByText("Paystack").tagName).toBe("STRONG");
    expect(container.querySelector("img[src=x]")).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
    expect(await screen.findByText(/Version 2026-08-28/)).toBeInTheDocument();
    expect(screen.queryByText("Built-in terms")).not.toBeInTheDocument();
  });
});

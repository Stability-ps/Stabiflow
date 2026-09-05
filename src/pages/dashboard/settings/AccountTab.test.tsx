// Launch readiness - Account settings surfaces the user's own durable
// Privacy/Terms acceptance record (read-only - no edit/delete controls,
// no re-consent flow). Missing acceptance (pre-existing users) must render
// honestly, not as an error or a compliance warning.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountTab } from "./AccountTab";

const mocks = vi.hoisted(() => ({ acceptances: [] as Array<Record<string, unknown>> }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "jane@example.com" },
    profile: { full_name: "Jane Test" },
    refreshMemberships: vi.fn(),
    signOut: vi.fn(),
  }),
}));
vi.mock("@/hooks/useLegalAcceptances", () => ({
  useOwnLegalAcceptances: () => ({ data: mocks.acceptances }),
}));
vi.mock("@/lib/accountProfile", () => ({ updateOwnProfile: vi.fn() }));

function renderAccount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AccountTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AccountTab - legal agreements", () => {
  afterEach(cleanup);

  it("renders accepted version and date when a record exists", () => {
    mocks.acceptances = [
      { document_type: "privacy_policy", document_version: "2026-09-04", accepted_at: "2026-09-05T10:00:00.000Z" },
      { document_type: "terms_of_service", document_version: "2026-08-28", accepted_at: "2026-09-05T10:00:00.000Z" },
    ];
    renderAccount();
    expect(screen.getByText(/Accepted .* · Version 2026-09-04/)).toBeInTheDocument();
    expect(screen.getByText(/Accepted .* · Version 2026-08-28/)).toBeInTheDocument();
  });

  it("renders honestly (not as an error) when there is no recorded acceptance", () => {
    mocks.acceptances = [];
    renderAccount();
    expect(screen.getAllByText("No recorded acceptance")).toHaveLength(2);
  });

  it("still links to the legal documents", () => {
    mocks.acceptances = [];
    renderAccount();
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/legal/privacy");
    expect(screen.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/legal/terms");
  });
});

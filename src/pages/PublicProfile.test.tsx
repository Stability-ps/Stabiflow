import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PublicProfile from "./PublicProfile";

const fetchPublicProfile = vi.fn();
vi.mock("@/lib/businessStudio", async (orig) => ({ ...(await orig<typeof import("@/lib/businessStudio")>()), fetchPublicProfile: (s: string) => fetchPublicProfile(s) }));

function renderAt(slug: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/b/${slug}`]}>
        <Routes>
          <Route path="/b/:slug" element={<PublicProfile />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const profile = {
  slug: "acme", template_key: "classic", show_enquiry: true, has_document: true,
  identity: { name: "Acme <b>Engineering</b>", legal_name: null, tagline: "Steel", short_description: null, long_description: "We build.", mission: null, vision: null, core_values: [], industry: null, website: "javascript:alert(1)", founded_year: null },
  brand: { primary: "red;background:url(x)", secondary: null, accent: "#F2A900", has_logo: false },
  contacts: [{ kind: "whatsapp", label: null, value: "082 555 0103" }, { kind: "email", label: null, value: "info@acme.co.za" }],
  locations: [], social_links: [{ platform: "facebook", url: "javascript:alert(2)" }, { platform: "linkedin", url: "https://linkedin.com/company/acme" }],
  offerings: [{ kind: "service", name: "Welding", description: null, price_text: null }], team: [], projects: [], certifications: [], identifiers: [],
};

describe("Public business profile", () => {
  afterEach(() => {
    cleanup();
    fetchPublicProfile.mockReset();
  });

  it("renders public facts as text, with safe enquiry links only", async () => {
    fetchPublicProfile.mockResolvedValue({ profile, logoUrl: null, documentUrl: "https://storage.example/signed.pdf" });
    const { container } = renderAt("acme");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Acme <b>Engineering</b>"));
    expect(container.querySelector("b")).toBeNull(); // markup in data is text, not HTML
    expect(screen.getByRole("link", { name: /WhatsApp us/ })).toHaveAttribute("href", expect.stringMatching(/^https:\/\/wa\.me\/27825550103\?text=/));
    expect(screen.getByRole("link", { name: /Email us/ })).toHaveAttribute("href", expect.stringMatching(/^mailto:info@acme\.co\.za/));
    expect(screen.getByRole("link", { name: /Download company profile/ })).toHaveAttribute("href", "https://storage.example/signed.pdf");
    expect(screen.getByText("Welding")).toBeInTheDocument();
    // javascript: URLs never become links
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.startsWith("javascript:"))).toBe(false);
    expect(screen.getByRole("link", { name: "linkedin" })).toBeInTheDocument();
    // An invalid brand colour falls back instead of injecting CSS
    expect(container.innerHTML).not.toContain("url(x)");
  });

  it("shows not found for unknown or unpublished profiles", async () => {
    fetchPublicProfile.mockResolvedValue(null);
    renderAt("nope");
    await waitFor(() => expect(screen.getByText("Profile not found")).toBeInTheDocument());
  });
});

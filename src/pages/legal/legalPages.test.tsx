// Launch readiness - Privacy/Terms effective dates now come from the
// shared src/lib/legalDocuments.ts constants (the same ones
// accept_current_legal_terms() is seeded to match), not a second
// hardcoded literal per page. This guards against the two drifting apart.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Privacy from "./Privacy";
import Terms from "./Terms";
import { PRIVACY_POLICY_VERSION, TERMS_OF_SERVICE_VERSION } from "@/lib/legalDocuments";

describe("Legal pages - effective dates from shared constants", () => {
  it("Privacy Policy shows PRIVACY_POLICY_VERSION", () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>);
    expect(screen.getByText(`Effective date: ${PRIVACY_POLICY_VERSION}`)).toBeInTheDocument();
  });

  it("Terms of Service shows TERMS_OF_SERVICE_VERSION", () => {
    render(<MemoryRouter><Terms /></MemoryRouter>);
    expect(screen.getByText(`Effective date: ${TERMS_OF_SERVICE_VERSION}`)).toBeInTheDocument();
  });
});

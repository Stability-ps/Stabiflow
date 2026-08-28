// Phase L (production completion). Signup must not create an account
// without the user explicitly agreeing to the Terms of Service and Privacy
// Policy - this is the only place consent is captured today (see
// docs/legal/README.md). The regression this guards against: a future edit
// accidentally makes the checkbox cosmetic (submit still fires with it
// unchecked), which would mean StabiFlow captures no consent at all.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import Signup from "@/pages/Signup";

const { signUpMock } = vi.hoisted(() => ({ signUpMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signUp: signUpMock,
    },
  },
}));

function renderSignup() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={["/signup"]}>
        <Signup />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe("Signup consent gate", () => {
  it("the Create account button is disabled until the Terms/Privacy checkbox is checked", async () => {
    renderSignup();
    await screen.findByLabelText(/full name/i);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Jane Test" } });
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: "jane@example.com" } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "supersecret1" } });

    const submitButton = screen.getByRole("button", { name: /create account/i });
    expect(submitButton).toBeDisabled();

    fireEvent.click(submitButton);
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("REGRESSION: signUp is only ever called once the consent checkbox is checked", async () => {
    signUpMock.mockResolvedValue({ error: null });
    renderSignup();
    await screen.findByLabelText(/full name/i);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Jane Test" } });
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: "jane@example.com" } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "supersecret1" } });

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);

    const submitButton = screen.getByRole("button", { name: /create account/i });
    expect(submitButton).not.toBeDisabled();
    fireEvent.click(submitButton);

    await waitFor(() => expect(signUpMock).toHaveBeenCalledTimes(1));
  });
});

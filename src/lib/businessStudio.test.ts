import { describe, expect, it } from "vitest";
import { describeProposal, safeHref, slugify, whatsappHref } from "./businessStudio";

describe("business studio helpers", () => {
  it("slugify strips company suffixes and unsafe characters", () => {
    expect(slugify("Acme Engineering (Pty) Ltd")).toBe("acme-engineering");
    expect(slugify("  Café & Co. ")).toBe("cafe-co");
    expect(slugify("x".repeat(80)).length).toBeLessThanOrEqual(60);
  });

  it("safeHref only allows http(s)", () => {
    expect(safeHref("https://acme.co.za")).toBe("https://acme.co.za/");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("not a url")).toBeNull();
  });

  it("whatsappHref converts local SA numbers to international", () => {
    expect(whatsappHref("082 555 0103")).toBe("https://wa.me/27825550103");
    expect(whatsappHref("+27 82 555 0103", "Hi")).toBe("https://wa.me/27825550103?text=Hi");
    expect(whatsappHref("123")).toBeNull();
  });

  it("describeProposal renders each target readably", () => {
    expect(describeProposal({ target: "contact", field: null, proposed: { kind: "email", value: "a@b.co" } })).toBe("email: a@b.co");
    expect(describeProposal({ target: "identity_field", field: "core_values", proposed: { value: ["A", "B"] } })).toBe("A, B");
    expect(describeProposal({ target: "project", field: null, proposed: { title: "Depot", client_name: "LogiCo" } })).toBe("Depot for LogiCo");
  });
});

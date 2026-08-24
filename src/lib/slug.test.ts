import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates a normal company name", () => {
    expect(slugify("Acapolite Consulting")).toBe("acapolite-consulting");
  });

  it("collapses repeated separators into one hyphen", () => {
    expect(slugify("A  &  B   Motors")).toBe("a-b-motors");
  });

  it("trims leading/trailing hyphens produced by punctuation at the edges", () => {
    expect(slugify("  -Solar Co.-  ")).toBe("solar-co");
  });

  it("strips characters that aren't ascii letters/digits", () => {
    expect(slugify("Café René™")).toBe("caf-ren");
  });

  it("returns an empty string for input with no usable characters", () => {
    expect(slugify("!!!")).toBe("");
  });
});

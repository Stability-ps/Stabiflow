import { describe, expect, it } from "vitest";
import { parseInline, parseLegalMarkdown, safeLegalHref } from "./legal";

describe("legal markdown", () => {
  it("parses headings, paragraphs and bullet lists", () => {
    const blocks = parseLegalMarkdown("## Refunds\nOnce-off purchases\nare refundable.\n\n- Within **7 days**\n- Unused only\n\nContact us.");
    expect(blocks.map((b) => b.kind)).toEqual(["h2", "p", "ul", "p"]);
    expect(blocks[1]).toEqual({ kind: "p", inline: [{ kind: "text", text: "Once-off purchases are refundable." }] });
    expect((blocks[2] as { items: unknown[] }).items).toHaveLength(2);
  });

  it("keeps only safe links; dangerous ones become plain text", () => {
    expect(parseInline("see [policy](/legal/privacy) and [x](javascript:alert(1))")).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", text: "policy", href: "/legal/privacy" },
      { kind: "text", text: " and " },
      { kind: "text", text: "x" },
      { kind: "text", text: ")" },
    ]);
    expect(safeLegalHref("mailto:privacy@stabiflow.com")).toBe("mailto:privacy@stabiflow.com");
    expect(safeLegalHref("//evil.example/x")).toBeNull();
    expect(safeLegalHref("data:text/html,<script>")).toBeNull();
  });

  it("never produces HTML - markup in text stays text", () => {
    const blocks = parseLegalMarkdown("<script>alert(1)</script> hello");
    expect(blocks).toEqual([{ kind: "p", inline: [{ kind: "text", text: "<script>alert(1)</script> hello" }] }]);
  });
});

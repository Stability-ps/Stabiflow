import { describe, expect, it } from "vitest";
import { aiHumanStatusText, buildMissingInfoReply, deliveryTone, inboxStatusLabel } from "./inboxPresentation";

describe("aiHumanStatusText", () => {
  it("tells staff AI is active and to take over before replying", () => {
    expect(aiHumanStatusText({ ai_enabled: true, assigned_staff_name: null })).toBe("AI is active. Take over or assign the chat before replying.");
  });

  it("names the assigned staff member when human control is active", () => {
    expect(aiHumanStatusText({ ai_enabled: false, assigned_staff_name: "Jane" })).toBe("Human control is active, assigned to Jane. AI replies are locked.");
  });

  it("still communicates human control even with nobody assigned yet", () => {
    expect(aiHumanStatusText({ ai_enabled: false, assigned_staff_name: null })).toBe("Human control is active. AI replies are locked.");
  });
});

describe("deliveryTone", () => {
  it("classifies read/delivered as healthy", () => {
    expect(deliveryTone("read")).toBe("healthy");
    expect(deliveryTone("delivered")).toBe("healthy");
  });

  it("classifies failed/error as error", () => {
    expect(deliveryTone("failed")).toBe("error");
    expect(deliveryTone("error")).toBe("error");
  });

  it("classifies in-flight statuses as attention", () => {
    expect(deliveryTone("sending")).toBe("attention");
    expect(deliveryTone("submitted")).toBe("attention");
  });

  it("falls back to neutral for null/unknown", () => {
    expect(deliveryTone(null)).toBe("neutral");
    expect(deliveryTone("something-new")).toBe("neutral");
  });
});

describe("inboxStatusLabel", () => {
  it("maps every known inbox_status to a human label", () => {
    expect(inboxStatusLabel("waiting_client")).toBe("Waiting on client");
    expect(inboxStatusLabel("new")).toBe("New");
  });
});

describe("buildMissingInfoReply", () => {
  it("returns an empty string when nothing is missing", () => {
    expect(buildMissingInfoReply([])).toBe("");
  });

  it("asks a single question for one missing field", () => {
    expect(buildMissingInfoReply(["email"])).toBe("Thanks for reaching out! Could you share an email address we can use?");
  });

  it("joins multiple missing fields naturally", () => {
    const result = buildMissingInfoReply(["customer_name", "email"]);
    expect(result).toContain("your full name");
    expect(result).toContain("an email address we can use");
    expect(result.startsWith("Thanks for reaching out!")).toBe(true);
  });

  it("falls back to the raw field name for an unrecognised field, rather than dropping it silently", () => {
    expect(buildMissingInfoReply(["custom_field"])).toContain("custom_field");
  });
});

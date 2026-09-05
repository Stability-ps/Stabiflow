import { describe, expect, it } from "vitest";
import { aiHumanStatusText, buildMissingInfoReply, computeMessagingWindowState, deliveryLabel, deliveryTone, inboxStatusLabel, messagingWindowLabel } from "./inboxPresentation";

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

describe("computeMessagingWindowState (display-only mirror of the server-side authoritative check)", () => {
  const NOW = new Date("2026-08-28T12:00:00.000Z");

  it("a message from moments ago is open", () => {
    expect(computeMessagingWindowState(new Date(NOW.getTime() - 60_000).toISOString(), NOW)).toBe("open");
  });

  it("exactly inside 24 hours is open", () => {
    expect(computeMessagingWindowState(new Date(NOW.getTime() - (23 * 60 + 59) * 60 * 1000).toISOString(), NOW)).toBe("open");
  });

  it("just outside 24 hours is closed", () => {
    expect(computeMessagingWindowState(new Date(NOW.getTime() - (24 * 60 + 1) * 60 * 1000).toISOString(), NOW)).toBe("closed");
  });

  it("no inbound message at all is unknown, never open", () => {
    expect(computeMessagingWindowState(null, NOW)).toBe("unknown");
  });
});

describe("messagingWindowLabel", () => {
  it("labels each state clearly", () => {
    expect(messagingWindowLabel("open")).toBe("Messaging window open");
    expect(messagingWindowLabel("closed")).toBe("24-hour window closed");
    expect(messagingWindowLabel("unknown")).toBe("Messaging window unknown");
  });
});

describe("deliveryLabel/deliveryTone for a window-blocked message", () => {
  it("labels blocked_window_closed clearly instead of a raw status string", () => {
    expect(deliveryLabel("blocked_window_closed")).toBe("Not sent - messaging window closed");
  });

  it("classifies blocked_window_closed as an error tone, never healthy/neutral", () => {
    expect(deliveryTone("blocked_window_closed")).toBe("error");
  });
});

describe("deliveryLabel/deliveryTone for a workspace-suspended blocked message", () => {
  it("labels blocked_workspace_suspended clearly instead of a raw status string", () => {
    expect(deliveryLabel("blocked_workspace_suspended")).toBe("Not sent - workspace suspended");
  });

  it("classifies blocked_workspace_suspended as an error tone, never healthy/neutral", () => {
    expect(deliveryTone("blocked_workspace_suspended")).toBe("error");
  });

  it("distinguishes blocked_workspace_suspended from blocked_window_closed in label text", () => {
    expect(deliveryLabel("blocked_workspace_suspended")).not.toBe(deliveryLabel("blocked_window_closed"));
  });
});

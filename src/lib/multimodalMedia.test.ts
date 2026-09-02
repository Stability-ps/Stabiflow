import { describe, it, expect } from "vitest";
import { aiMediaBadge, AI_MEDIA_SUPPORTED_FORMATS } from "./multimodalMedia";

describe("aiMediaBadge (frontend mirror)", () => {
  it("shows an honest badge only for meaningful states", () => {
    expect(aiMediaBadge("processed")).toEqual({ label: "AI read", tone: "ok" });
    expect(aiMediaBadge("failed")).toEqual({ label: "AI couldn't read", tone: "warn" });
    expect(aiMediaBadge("unsupported")).toEqual({ label: "Unsupported for AI", tone: "muted" });
    expect(aiMediaBadge("too_large")).toEqual({ label: "Too large for AI", tone: "muted" });
  });

  it("shows nothing when the AI was never asked to read the attachment", () => {
    expect(aiMediaBadge("not_requested")).toBeNull();
    expect(aiMediaBadge(null)).toBeNull();
    expect(aiMediaBadge(undefined)).toBeNull();
  });

  it("advertises exactly the supported formats", () => {
    expect(AI_MEDIA_SUPPORTED_FORMATS.images).toEqual(["JPEG", "PNG", "WebP"]);
    expect(AI_MEDIA_SUPPORTED_FORMATS.documents).toEqual(["PDF"]);
  });
});

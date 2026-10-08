import { describe, expect, it } from "vitest";
import type { WhatsAppTemplateRow } from "@/hooks/useInboxTemplates";
import { filterWhatsAppTemplates } from "./templateFilters";

const templates: WhatsAppTemplateRow[] = [
  { id: "1", name: "acapolite_request_follow_up", language: "en", category: "UTILITY", provider_status: "APPROVED", components: [{ type: "BODY", text: "Hello. Acapolite Consulting is following up regarding your tax assistance request." }] },
  { id: "2", name: "hello_world", language: "en_US", category: "UTILITY", provider_status: "APPROVED", components: [{ type: "BODY", text: "Welcome and congratulations!! This message demonstrates your ability to send a WhatsApp message notification from the Cloud API." }] },
  { id: "3", name: "stabiflow_account_update", language: "en", category: "UTILITY", provider_status: "APPROVED", components: [{ type: "BODY", text: "Hello, this is an update regarding your account." }] },
];

describe("WhatsApp template filtering", () => {
  it("searches both template names and message bodies", () => {
    expect(filterWhatsAppTemplates(templates, "hello", "ALL", "ALL").map((t) => t.id)).toEqual(["1", "2", "3"]);
    expect(filterWhatsAppTemplates(templates, "tax assistance", "ALL", "ALL").map((t) => t.id)).toEqual(["1"]);
    expect(filterWhatsAppTemplates(templates, "cloud api", "ALL", "ALL").map((t) => t.id)).toEqual(["2"]);
    expect(filterWhatsAppTemplates(templates, "account", "ALL", "ALL").map((t) => t.id)).toEqual(["3"]);
  });

  it("combines search, category and status filters", () => {
    expect(filterWhatsAppTemplates(templates, "hello", "UTILITY", "APPROVED")).toHaveLength(3);
    expect(filterWhatsAppTemplates(templates, "does-not-exist", "UTILITY", "APPROVED")).toHaveLength(0);
  });

  it("is case-insensitive and trims the query", () => {
    expect(filterWhatsAppTemplates(templates, "  CLOUD API  ", "ALL", "ALL").map((t) => t.id)).toEqual(["2"]);
  });
});

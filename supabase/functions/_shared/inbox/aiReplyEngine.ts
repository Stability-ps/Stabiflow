// AI reply generation (Phase D). Adapted from Acapolite's whatsapp-agent
// askAI() - same mechanism (OpenAI Responses API, strict JSON-schema
// structured output, recent-history context, a "next priority" hint), but
// with a generic lead-qualification extraction schema instead of Acapolite's
// hardcoded tax/SARS field set. A later phase can layer a richer,
// workspace-configurable qualification schema on top without touching this
// call shape.
//
// Deliberately NOT ported: the localize() translation pass and the
// missing-field "question bank" ladder - both are real features, cut here
// to keep Phase D's scope to the Inbox/AI-human-control foundation the
// brief asked for; see the Phase D completion report.
export type ConversationHistoryMessage = {
  direction: string;
  content: string | null;
};

export type Extracted = {
  customer_name: string | null;
  email: string | null;
  interest_summary: string | null;
  urgency: "low" | "normal" | "high" | null;
};

export type AIResult = {
  reply: string;
  human_handoff_requested: boolean;
  extracted: Extracted;
};

export type AIReplyCredential = { apiKey: string; model: string };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "human_handoff_requested", "extracted"],
  properties: {
    reply: { type: "string" },
    human_handoff_requested: { type: "boolean" },
    extracted: {
      type: "object",
      additionalProperties: false,
      required: ["customer_name", "email", "interest_summary", "urgency"],
      properties: {
        customer_name: { anyOf: [{ type: "string" }, { type: "null" }] },
        email: { anyOf: [{ type: "string" }, { type: "null" }] },
        interest_summary: { anyOf: [{ type: "string" }, { type: "null" }] },
        urgency: { anyOf: [{ type: "string", enum: ["low", "normal", "high"] }, { type: "null" }] },
      },
    },
  },
};

export function buildAIInstructions(businessName: string): string {
  return [
    `You are ${businessName}'s AI-assisted WhatsApp assistant, helping customers on WhatsApp.`,
    "Be calm, friendly, and helpful. Keep the reply to at most two short WhatsApp paragraphs.",
    "You have no personal human name. Never invent a name, biography, or personal identity.",
    "If directly asked whether you are AI, answer truthfully and briefly, then offer a human if they prefer.",
    "Never claim that an action (sending, creating, escalating, contacting someone) has happened unless system context confirms it.",
    "If the customer asks for a human, a person, or a team member, set human_handoff_requested true immediately.",
    "extracted.interest_summary is a concise, cumulative summary of what the customer wants help with - never include greetings or assistant self-talk.",
    "Only fill customer_name/email when the customer has actually stated them in this conversation.",
  ].join(" ");
}

export function buildAIInputText(history: ConversationHistoryMessage[], latest: string, current: Record<string, unknown>): string {
  const recent = history.slice(-16).map((m) => `${m.direction === "inbound" ? "Customer" : "Assistant"}: ${m.content || ""}`).join("\n");
  return `Current known details: ${JSON.stringify(current)}\nRecent chat:\n${recent}\nLatest customer message: ${latest || "Please review the attached document."}`;
}

export async function generateAIReply(
  cred: AIReplyCredential,
  businessName: string,
  history: ConversationHistoryMessage[],
  latest: string,
  current: Record<string, unknown>,
): Promise<AIResult> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${cred.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cred.model,
      store: false,
      instructions: buildAIInstructions(businessName),
      input: [{ role: "user", content: [{ type: "input_text", text: buildAIInputText(history, latest, current) }] }],
      text: { verbosity: "low", format: { type: "json_schema", name: "stabiflow_whatsapp_reply", strict: true, schema: SCHEMA } },
    }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`OpenAI failed (${response.status}): ${raw.slice(0, 400)}`);
  const data = JSON.parse(raw);
  let output = typeof data?.output_text === "string" ? data.output_text : "";
  if (!output) {
    for (const item of data?.output || []) {
      for (const part of item?.content || []) {
        if (part?.type === "output_text") output = part.text;
      }
    }
  }
  if (!output) throw new Error("OpenAI returned no structured output");
  return JSON.parse(output) as AIResult;
}

export function mergeExtracted(current: Record<string, unknown>, extracted: Extracted): Record<string, unknown> {
  const next: Record<string, unknown> = { ...current };
  if (extracted.customer_name) next.customer_name = extracted.customer_name;
  if (extracted.email) next.email = extracted.email;
  if (extracted.interest_summary) next.interest_summary = extracted.interest_summary;
  if (extracted.urgency) next.urgency = extracted.urgency;
  return next;
}

export function missingFields(intake: Record<string, unknown>): string[] {
  const missing: string[] = [];
  if (!intake.customer_name) missing.push("customer_name");
  if (!intake.email) missing.push("email");
  if (!intake.interest_summary) missing.push("interest_summary");
  return missing;
}

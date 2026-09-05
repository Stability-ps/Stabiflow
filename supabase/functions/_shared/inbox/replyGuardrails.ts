// AI reply safety guardrails (Phase D). Adapted from Acapolite's
// whatsapp-agent/index.ts - these are genuinely tenant/domain-agnostic
// text-safety checks (does the AI's own reply claim an action it never
// took, invent a human identity, etc.); only the tax/SARS-specific
// vocabulary ("mandate", "engagement letter") is dropped, the detection
// PATTERN is unchanged.
export function cleanReply(raw: string): string {
  let text = String(raw || "")
    .replace(/[—–]/g, ",")
    .replace(/^\s*[•-]\s+/gm, "")
    .replace(/\s+,/g, ",")
    .replace(/,{2,}/g, ",")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  text = text.replace(/\b(Thanks|Thank you|Okay|Great|Perfect|Got it),?\s+(I(?:'ve| have)?\s+)?(noted|recorded|captured)\b[^.!?]*[.!?]?\s*/gi, "").trim();
  const sentences = text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  if (!text.includes("\n\n") && sentences.length > 2) {
    text = `${sentences.slice(0, 2).join(" ")}\n\n${sentences.slice(2, 4).join(" ")}`.trim();
  }
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).slice(0, 2);
  text = paragraphs.join("\n\n");
  if (text.length > 360) {
    const cut = text.slice(0, 360);
    const stop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("?"), cut.lastIndexOf("!"));
    text = (stop > 180 ? cut.slice(0, stop + 1) : cut).trim();
  }
  return text;
}

// Regex-based fallback alongside the AI's own judgment (askAI's
// human_handoff_requested field) - two independent signals catch more than
// either alone, and this one costs nothing to check before the AI call.
export function requestsHumanHandoff(text: string): boolean {
  const normalized = text.toLowerCase().replace(/['']/g, "'").replace(/\s+/g, " ").trim();
  const person = "human|person|someone|agent|advisor|adviser|team|staff|manager|supervisor";
  const action = "speak|talk|chat|connect|transfer|handover|hand over|put me through|call|phone|contact|assist|help";
  return new RegExp(`\\b(?:${action})\\b.{0,50}\\b(?:${person})\\b`, "i").test(normalized)
    || new RegExp(`\\b(?:${person})\\b.{0,40}\\b(?:please|now|instead|directly|call|phone|contact|assist|help|speak|talk|chat)\\b`, "i").test(normalized)
    || /\b(i want|i need|give me|get me)\b.{0,35}\b(human|person|someone|agent|advisor|adviser)\b/i.test(normalized);
}

export function containsFalseActionClaim(text: string): boolean {
  return /\b(i('|’)ll|i will|we('|’)ll|we will|i have|we have)\s+(prepare|send|issue|email|create|submit|file|contact|assign|connect|start|open|escalate|forward|arrange)\b/i.test(text)
    || /\b(has been|was)\s+(submitted|filed|sent|assigned|connected|escalated|forwarded)\b/i.test(text);
}

export function containsInventedPersonalIdentity(text: string): boolean {
  // [Ii](?:'m|\s+am) matches "I'm"/"i'm"/"I am"/"i am" without needing a
  // global /i flag - the source Acapolite regex this was ported from used
  // a global /i-less pattern with a literal lowercase "i'm", which almost
  // never fires since a sentence-initial "I'm" is capitalized in practice.
  // A plain /i flag over the whole pattern was tried and rejected: it also
  // makes [A-Z] match lowercase letters, so "I'm happy to help" (no name)
  // would false-positive - the capitalized-name check must stay case-strict.
  return /\bmy (full )?name is\b/i.test(text)
    || /\b[Ii](?:'m|\s+am)\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(text);
}

export function isSimpleGreeting(text: string): boolean {
  return /^(hi|hello|hey|good\s+(morning|afternoon|evening)|howzit)[!. ]*$/i.test(text.trim());
}

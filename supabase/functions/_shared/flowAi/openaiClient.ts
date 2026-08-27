// Flow AI's OpenAI Responses API client (Phase I) - raw fetch + manual SSE
// parsing, no AI SDK dependency, per explicit direction: prefer the same
// direct-fetch approach aiReplyEngine.ts (WhatsApp AI, Phase D) already
// uses against this same API family. This module is intentionally the
// only piece "genuinely reusable" between the two AI systems (a low-level
// HTTP client) - aiReplyEngine.ts is left untouched; Phase D's proven
// system is not refactored to depend on this.
//
// Text is streamed to the caller as it arrives (response.output_text.delta
// events) for a responsive UI, but the AUTHORITATIVE tool-calls-made and
// token-usage numbers are read from the terminal response.completed
// event's full payload, not reconstructed from accumulated deltas - this
// avoids an entire class of subtle "did I reassemble the JSON arguments
// string correctly across delta chunks" bugs for the one part
// (tool-call args, usage/cost accounting) that must be exactly right.
export type FlowAiInputItem =
  | { role: "user"; content: [{ type: "input_text"; text: string }] }
  | { role: "assistant"; content: [{ type: "output_text"; text: string }] }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

export type FlowAiToolSpec = { name: string; description: string; parameters: Record<string, unknown> };

export type FlowAiFunctionCall = { callId: string; name: string; arguments: string };

export type FlowAiCompletedResult = {
  text: string;
  functionCalls: FlowAiFunctionCall[];
  inputTokens: number;
  outputTokens: number;
};

export type FlowAiStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "completed"; result: FlowAiCompletedResult }
  | { type: "error"; message: string };

// Deno's fetch Response.body is a ReadableStream<Uint8Array> - decode and
// split on SSE's blank-line frame boundary ("\n\n"), same shape any SSE
// source uses regardless of provider.
async function* iterateSseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string | null; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        let event: string | null = null;
        const dataLines: string[] = [];
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length > 0) yield { event, data: dataLines.join("\n") };
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* streamFlowAiResponse(opts: {
  apiKey: string;
  model: string;
  instructions: string;
  input: FlowAiInputItem[];
  tools: FlowAiToolSpec[];
  signal?: AbortSignal;
}): AsyncGenerator<FlowAiStreamEvent> {
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      signal: opts.signal,
      body: JSON.stringify({
        model: opts.model,
        store: false,
        stream: true,
        instructions: opts.instructions,
        input: opts.input,
        tools: opts.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters })),
      }),
    });
  } catch (err) {
    yield { type: "error", message: `Failed to reach OpenAI: ${err instanceof Error ? err.message : String(err)}` };
    return;
  }

  if (!response.ok || !response.body) {
    const raw = await response.text().catch(() => "");
    yield { type: "error", message: `OpenAI returned ${response.status}: ${raw.slice(0, 300)}` };
    return;
  }

  for await (const frame of iterateSseEvents(response.body)) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(frame.data);
    } catch {
      continue;
    }
    const type = (frame.event || (parsed.type as string) || "") as string;

    if (type === "response.output_text.delta" && typeof parsed.delta === "string") {
      yield { type: "text_delta", text: parsed.delta };
      continue;
    }
    if (type === "response.completed") {
      const responseObj = (parsed.response as Record<string, unknown>) ?? parsed;
      yield { type: "completed", result: extractCompletedResult(responseObj) };
      continue;
    }
    if (type === "response.failed" || type === "error") {
      const message = (parsed.response as { error?: { message?: string } } | undefined)?.error?.message
        ?? (parsed.message as string | undefined)
        ?? "OpenAI request failed";
      yield { type: "error", message };
      continue;
    }
  }
}

function extractCompletedResult(responseObj: Record<string, unknown>): FlowAiCompletedResult {
  const output = (responseObj.output as Array<Record<string, unknown>>) ?? [];
  const functionCalls: FlowAiFunctionCall[] = [];
  let text = "";
  for (const item of output) {
    if (item.type === "function_call") {
      functionCalls.push({ callId: String(item.call_id ?? ""), name: String(item.name ?? ""), arguments: String(item.arguments ?? "{}") });
    } else if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content as Array<Record<string, unknown>>) {
        if (part.type === "output_text" && typeof part.text === "string") text += part.text;
      }
    }
  }
  const usage = (responseObj.usage as { input_tokens?: number; output_tokens?: number } | undefined) ?? {};
  return { text, functionCalls, inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 };
}

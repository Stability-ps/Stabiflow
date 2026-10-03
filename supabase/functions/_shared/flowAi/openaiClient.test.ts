// Tests the SSE-parsing/event-extraction logic against a MOCKED fetch -
// never a real OpenAI call, per direction to avoid consuming real API
// usage merely to make the test suite pass.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { streamFlowAiResponse } from "./openaiClient.ts";

function sseResponse(frames: { event?: string; data: unknown }[], status = 200): Response {
  const body = frames.map((f) => `${f.event ? `event: ${f.event}\n` : ""}data: ${JSON.stringify(f.data)}\n\n`).join("");
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status });
}

function withMockedFetch(response: Response | (() => Promise<Response>), run: () => Promise<void>) {
  const original = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  globalThis.fetch = (typeof response === "function" ? response : () => Promise.resolve(response)) as any;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

Deno.test("streamFlowAiResponse yields text deltas as they arrive", async () => {
  const frames = [
    { event: "response.output_text.delta", data: { delta: "Hello " } },
    { event: "response.output_text.delta", data: { delta: "there." } },
    { event: "response.completed", data: { response: { output: [{ type: "message", content: [{ type: "output_text", text: "Hello there." }] }], usage: { input_tokens: 10, output_tokens: 5 } } } },
  ];
  await withMockedFetch(sseResponse(frames), async () => {
    const events: string[] = [];
    for await (const evt of streamFlowAiResponse({ apiKey: "test-key", model: "gpt-4o-mini", instructions: "x", input: [], tools: [] })) {
      events.push(evt.type);
      if (evt.type === "text_delta") assertEquals(["Hello ", "there."].includes(evt.text), true);
      if (evt.type === "completed") {
        assertEquals(evt.result.text, "Hello there.");
        assertEquals(evt.result.functionCalls.length, 0);
        assertEquals(evt.result.inputTokens, 10);
        assertEquals(evt.result.outputTokens, 5);
      }
    }
    assertEquals(events, ["text_delta", "text_delta", "completed"]);
  });
});

Deno.test("streamFlowAiResponse extracts function_call items from the completed event", async () => {
  const frames = [
    { event: "response.completed", data: { response: { output: [{ type: "function_call", call_id: "call_1", name: "list_leads", arguments: '{"status":"active"}' }], usage: { input_tokens: 20, output_tokens: 8 } } } },
  ];
  await withMockedFetch(sseResponse(frames), async () => {
    let completed;
    for await (const evt of streamFlowAiResponse({ apiKey: "test-key", model: "gpt-4o-mini", instructions: "x", input: [], tools: [] })) {
      if (evt.type === "completed") completed = evt.result;
    }
    assertEquals(completed?.functionCalls, [{ callId: "call_1", name: "list_leads", arguments: '{"status":"active"}' }]);
  });
});

Deno.test("streamFlowAiResponse yields an error event on a non-OK HTTP response, never throwing raw", async () => {
  await withMockedFetch(new Response("rate limited", { status: 429 }), async () => {
    const events: string[] = [];
    for await (const evt of streamFlowAiResponse({ apiKey: "test-key", model: "gpt-4o-mini", instructions: "x", input: [], tools: [] })) {
      events.push(evt.type);
    }
    assertEquals(events, ["error"]);
  });
});

Deno.test("streamFlowAiResponse yields an error event when fetch itself rejects (network failure)", async () => {
  await withMockedFetch(() => Promise.reject(new Error("network down")), async () => {
    const events: string[] = [];
    for await (const evt of streamFlowAiResponse({ apiKey: "test-key", model: "gpt-4o-mini", instructions: "x", input: [], tools: [] })) {
      events.push(evt.type);
    }
    assertEquals(events, ["error"]);
  });
});

Deno.test("streamFlowAiResponse never includes the API key anywhere in a yielded event", async () => {
  const secretKey = "sk-super-secret-value-should-never-appear";
  const frames = [{ event: "response.completed", data: { response: { output: [], usage: { input_tokens: 1, output_tokens: 1 } } } }];
  await withMockedFetch(sseResponse(frames), async () => {
    for await (const evt of streamFlowAiResponse({ apiKey: secretKey, model: "gpt-4o-mini", instructions: "x", input: [], tools: [] })) {
      assertEquals(JSON.stringify(evt).includes(secretKey), false);
    }
  });
});

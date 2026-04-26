import { describe, it, expect, beforeEach, vi } from "vitest";
import { stubAzureError, makeJsonRequest } from "../_test-helpers";

vi.mock("@/lib/azure-auth", () => ({
  getAzureEndpoint: () => "https://test-endpoint.openai.azure.com",
  getAuthHeaders: async () => ({ "api-key": "test-key" }),
}));

async function loadRoute() {
  return import("./route");
}

/**
 * Build a fake upstream Azure SSE stream. Each chunk becomes one SSE event
 * with delta.content set to the provided string. Always terminated with [DONE].
 */
function makeUpstreamSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const c of chunks) {
        const payload = JSON.stringify({ choices: [{ delta: { content: c } }] });
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function stubStreamingFetch(chunks: string[]) {
  const spy = vi.fn(async () => makeUpstreamSseResponse(chunks));
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

async function readSseStream(res: Response): Promise<string[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  buf += decoder.decode();
  for (const line of buf.split("\n")) {
    const t = line.trim();
    if (t.startsWith("data: ")) events.push(t.slice(6));
  }
  return events;
}

describe("POST /api/generate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 when prompt is missing", async () => {
    stubStreamingFetch([]);
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when prompt is non-string", async () => {
    stubStreamingFetch([]);
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ prompt: { not: "a string" } }));
    expect(res.status).toBe(400);
  });

  it("forwards Azure SSE chunks as content-only events", async () => {
    stubStreamingFetch(["a -> b\n", "c -> d\n"]);
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ prompt: "make a diagram" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const events = await readSseStream(res);
    // Expect 2 content events + [DONE]
    expect(events).toContain("[DONE]");
    const contentEvents = events.filter((e) => e !== "[DONE]");
    expect(contentEvents).toHaveLength(2);
    expect(JSON.parse(contentEvents[0])).toEqual({ content: "a -> b\n" });
    expect(JSON.parse(contentEvents[1])).toEqual({ content: "c -> d\n" });
  });

  it("includes existingCode + edit instruction when provided", async () => {
    const fetchSpy = stubStreamingFetch(["x"]);
    const { POST } = await loadRoute();
    await POST(
      makeJsonRequest({
        prompt: "add a node",
        existingCode: "a -> b",
      })
    );
    const calls = fetchSpy.mock.calls as unknown as Array<[string, RequestInit]>;
    const init = calls[0]?.[1];
    const sentBody = JSON.parse(init.body as string) as { messages: Array<{ role: string; content: string }> };
    const roles = sentBody.messages.map((m) => m.role);
    // system, assistant (existingCode), user (edit instruction)
    expect(roles[0]).toBe("system");
    expect(roles).toContain("assistant");
    const lastUser = sentBody.messages.findLast?.((m) => m.role === "user")
      ?? [...sentBody.messages].reverse().find((m) => m.role === "user");
    expect(lastUser?.content).toContain("add a node");
    expect(lastUser?.content).toContain("Modify the above D2 diagram");
  });

  it("appends history messages when provided", async () => {
    const fetchSpy = stubStreamingFetch(["x"]);
    const { POST } = await loadRoute();
    await POST(
      makeJsonRequest({
        prompt: "next thing",
        history: [
          { role: "user", content: "earlier prompt" },
          { role: "assistant", content: "earlier reply" },
        ],
      })
    );
    const calls = fetchSpy.mock.calls as unknown as Array<[string, RequestInit]>;
    const init = calls[0]?.[1];
    const sent = JSON.parse(init.body as string) as { messages: Array<{ role: string; content: string }> };
    expect(sent.messages.some((m) => m.content === "earlier prompt")).toBe(true);
    expect(sent.messages.some((m) => m.content === "earlier reply")).toBe(true);
  });

  it("propagates upstream non-2xx status", async () => {
    stubAzureError(401, "unauthorised");
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ prompt: "anything" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/LLM API error/);
  });

  it("filters malformed SSE chunks instead of crashing", async () => {
    // Inject a malformed JSON line into a custom upstream stream
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("data: {not-json\n\n"));
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n`)
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    globalThis.fetch = vi.fn(async () =>
      new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })
    ) as unknown as typeof fetch;

    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ prompt: "x" }));
    expect(res.status).toBe(200);
    const events = await readSseStream(res);
    const content = events.filter((e) => e !== "[DONE]");
    expect(content).toHaveLength(1);
    expect(JSON.parse(content[0])).toEqual({ content: "ok" });
  });
});

// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

const endpoint = vi.hoisted(() => ({ value: "https://test-endpoint.openai.azure.com" }));

vi.mock("@/lib/azure-auth", () => ({
  getAzureEndpoint: () => endpoint.value,
  getAuthHeaders: async () => ({ Authorization: "Bearer test-token" }),
}));

import { AzureProvider } from "./azure-provider";
import type { LlmRequest } from "./types";

function request(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    selection: { provider: "azure", model: "gpt-4o" },
    credentials: { kind: "machine" },
    system: "SYS",
    prompt: "PROMPT",
    ...overrides,
  };
}

function sse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("data: {not-json\n\n"));
        for (const c of chunks) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

describe("AzureProvider", () => {
  beforeEach(() => {
    endpoint.value = "https://test-endpoint.openai.azure.com";
    vi.restoreAllMocks();
  });

  it("is only configured when an endpoint is set", async () => {
    const provider = new AzureProvider();
    expect(provider.isConfigured()).toBe(true);
    endpoint.value = "";
    expect(provider.isConfigured()).toBe(false);
    expect(await provider.listModels()).toEqual([]);
    await expect(provider.complete(request())).rejects.toMatchObject({ code: "not_configured" });
  });

  it("lists the static deployment catalog", async () => {
    const models = await new AzureProvider().listModels();
    expect(models.find((m) => m.id === "gpt-4o")).toMatchObject({ provider: "azure", vision: true, reasoningEfforts: [] });
  });

  it("sends system, history and prompt as chat messages with Entra auth", async () => {
    const fetchSpy = vi.fn(async () => Response.json({ choices: [{ message: { content: "ok" } }] }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const result = await new AzureProvider().complete(
      request({ history: [{ role: "user", content: "earlier" }], temperature: 0.2 }),
    );
    expect(result.text).toBe("ok");
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/openai/deployments/gpt-4o/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
    const body = JSON.parse(init.body as string);
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user", "user"]);
    expect(body.temperature).toBe(0.2);
    expect(body.max_completion_tokens).toBe(4000);
  });

  it("encodes images as image_url content parts", async () => {
    const fetchSpy = vi.fn(async () => Response.json({ choices: [{ message: { content: "{}" } }] }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await new AzureProvider().complete(request({ images: [{ mimeType: "image/png", base64: "QUJD" }] }));
    const body = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages[1].content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,QUJD", detail: "high" } });
  });

  it("streams SSE deltas and skips malformed frames", async () => {
    globalThis.fetch = vi.fn(async () => sse(["a -> b\n", "c -> d\n"])) as unknown as typeof fetch;
    const deltas: string[] = [];
    const result = await new AzureProvider().stream(request({ selection: { provider: "azure", model: "gpt-5.2-chat" } }), (c) =>
      deltas.push(c),
    );
    expect(deltas).toEqual(["a -> b\n", "c -> d\n"]);
    expect(result.text).toBe("a -> b\nc -> d\n");
  });

  it("maps upstream HTTP errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    await expect(new AzureProvider().complete(request())).rejects.toMatchObject({ code: "unauthenticated", status: 401 });
  });

  it("rejects unknown deployments", async () => {
    await expect(new AzureProvider().complete(request({ selection: { provider: "azure", model: "nope" } }))).rejects.toMatchObject({
      code: "model_unavailable",
    });
  });
});

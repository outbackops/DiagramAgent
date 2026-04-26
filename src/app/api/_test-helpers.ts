import { vi, type MockedFunction } from "vitest";

/**
 * Mock the Azure auth module so route handlers can run without credentials.
 * Returns a static API-key header. Tests that import a route should call this
 * BEFORE importing the route module (use vi.mock at top of test file, then
 * dynamic import in the test).
 */
export function mockAzureAuth() {
  vi.mock("@/lib/azure-auth", () => ({
    getAzureEndpoint: () => "https://test-endpoint.openai.azure.com",
    getAuthHeaders: async () => ({ "api-key": "test-key" }),
  }));
}

/**
 * Build a Next-compatible fake NextRequest from a JSON body.
 */
export function makeJsonRequest(body: unknown, url = "http://localhost/api/test") {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

/**
 * Stub a global fetch that returns a successful Azure chat-completions
 * response with the given JSON content as the assistant message.
 *
 * Returns the spy + a helper that lets you assert what was called.
 */
export interface FetchSpy {
  spy: MockedFunction<typeof fetch>;
  /** First argument (the URL) of the most recent call. */
  lastUrl(): string;
  /** Parsed JSON body of the most recent call. */
  lastBody(): Record<string, unknown>;
  /** Reset call history. */
  reset(): void;
}

export function stubAzureFetch(content: string | object): FetchSpy {
  const responseContent = typeof content === "string" ? content : JSON.stringify(content);
  const spy = vi.fn(async () => {
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: responseContent } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as unknown as MockedFunction<typeof fetch>;

  globalThis.fetch = spy;

  return {
    spy,
    lastUrl(): string {
      const calls = spy.mock.calls;
      const last = calls[calls.length - 1];
      return typeof last?.[0] === "string"
        ? last[0]
        : (last?.[0] as Request)?.url ?? String(last?.[0]);
    },
    lastBody(): Record<string, unknown> {
      const calls = spy.mock.calls;
      const last = calls[calls.length - 1];
      const init = last?.[1];
      const raw = (init?.body as string) ?? "{}";
      return JSON.parse(raw);
    },
    reset() {
      spy.mockClear();
    },
  };
}

/**
 * Stub a fetch that returns a non-2xx error response.
 */
export function stubAzureError(status: number, message = "upstream failure"): MockedFunction<typeof fetch> {
  const spy = vi.fn(async () => {
    return new Response(message, { status, headers: { "Content-Type": "text/plain" } });
  }) as unknown as MockedFunction<typeof fetch>;
  globalThis.fetch = spy;
  return spy;
}

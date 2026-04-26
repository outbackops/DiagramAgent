import { describe, it, expect, beforeEach, vi } from "vitest";
import { stubAzureFetch, stubAzureError, makeJsonRequest } from "../_test-helpers";

vi.mock("@/lib/azure-auth", () => ({
  getAzureEndpoint: () => "https://test-endpoint.openai.azure.com",
  getAuthHeaders: async () => ({ "api-key": "test-key" }),
}));

async function loadRoute() {
  return import("./route");
}

const VALID_PLAN = {
  pattern: "HA/DR with SQL Always On",
  provider: "Azure",
  components: [{ name: "AppGateway", type: "resource" }],
  hierarchy: { Subscription: { PrimaryRegion: ["AppGateway"] } },
  connections: [{ from: "Users", to: "Subscription.PrimaryRegion.AppGateway", label: "HTTPS" }],
};

describe("POST /api/plan", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 when prompt is missing", async () => {
    stubAzureFetch(VALID_PLAN);
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when prompt is non-string", async () => {
    stubAzureFetch(VALID_PLAN);
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ prompt: ["array"] }));
    expect(res.status).toBe(400);
  });

  it("returns parsed plan on a valid Azure response", async () => {
    const fetchSpy = stubAzureFetch(VALID_PLAN);
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ prompt: "HA Azure SQL setup" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan).toMatchObject({
      pattern: "HA/DR with SQL Always On",
      provider: "Azure",
    });

    // Snapshot what went to Azure
    const sent = fetchSpy.lastBody();
    expect(sent).toMatchObject({
      messages: expect.any(Array),
      max_completion_tokens: 8000,
    });
    const messages = sent.messages as Array<{ role: string; content: string }>;
    expect(messages[1].content).toContain("HA Azure SQL setup");
  });

  it("includes analysis context in user prompt when provided", async () => {
    const fetchSpy = stubAzureFetch(VALID_PLAN);
    const { POST } = await loadRoute();
    await POST(
      makeJsonRequest({
        prompt: "anything",
        analysis: { pattern: "X", provider: "Y" },
      })
    );
    const sent = fetchSpy.lastBody();
    const messages = sent.messages as Array<{ role: string; content: string }>;
    expect(messages[1].content).toContain("Expert analysis context");
    expect(messages[1].content).toContain('"pattern": "X"');
  });

  it("returns 422 on malformed plan JSON", async () => {
    stubAzureFetch("not valid json {");
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ prompt: "anything" }));
    expect(res.status).toBe(422);
  });

  it("propagates upstream Azure errors", async () => {
    stubAzureError(429, "rate limited");
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ prompt: "anything" }));
    expect(res.status).toBe(429);
  });

  it("rejects non-object plan responses (zod refine)", async () => {
    stubAzureFetch("[1, 2, 3]");
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ prompt: "anything" }));
    expect(res.status).toBe(422);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { stubAzureFetch, stubAzureError, makeJsonRequest } from "../_test-helpers";

// Must be hoisted before route import
vi.mock("@/lib/azure-auth", () => ({
  getAzureEndpoint: () => "https://test-endpoint.openai.azure.com",
  getAuthHeaders: async () => ({ "api-key": "test-key" }),
}));

// Dynamic import so the mock is applied first
async function loadRoute() {
  return import("./route");
}

const VALID_CLARIFY_RESPONSE = {
  analysis: "HA/DR Azure pattern detected with 3/5 completeness",
  skipClarification: false,
  questions: [
    {
      id: "q1",
      question: "Which monitoring services?",
      rationale: "Cross-cutting placement",
      type: "multi",
      options: [
        { label: "Azure Monitor", value: "azure-monitor" },
        { label: "Other", value: "other" },
      ],
    },
  ],
};

describe("POST /api/clarify", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 when prompt is missing", async () => {
    stubAzureFetch(VALID_CLARIFY_RESPONSE);
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/prompt/i);
  });

  it("returns 400 when prompt is non-string", async () => {
    stubAzureFetch(VALID_CLARIFY_RESPONSE);
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ prompt: 42 }));
    expect(res.status).toBe(400);
  });

  it("returns parsed questions on a valid Azure response", async () => {
    const fetchSpy = stubAzureFetch(VALID_CLARIFY_RESPONSE);
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ prompt: "Build me an HA Azure SQL setup" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.questions).toHaveLength(1);
    expect(body.questions[0].id).toBe("q1");
    expect(body.skipClarification).toBe(false);
    expect(body.analysis).toMatch(/HA\/DR/);

    // Snapshot the request body that went to Azure
    const sent = fetchSpy.lastBody();
    expect(sent).toMatchObject({
      messages: expect.any(Array),
      max_completion_tokens: expect.any(Number),
    });
    const messages = sent.messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("HA Azure SQL setup");
  });

  it("auto-assigns question ids when missing", async () => {
    stubAzureFetch({
      ...VALID_CLARIFY_RESPONSE,
      questions: [{ ...VALID_CLARIFY_RESPONSE.questions[0], id: undefined }],
    });
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ prompt: "anything" }));
    const body = await res.json();
    expect(body.questions[0].id).toBe("q1");
  });

  it("returns 422 on malformed Azure JSON", async () => {
    stubAzureFetch("not valid json {");
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ prompt: "anything" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/generate questions/i);
  });

  it("propagates upstream Azure errors with their status", async () => {
    stubAzureError(503, "upstream is down");
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ prompt: "anything" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/LLM API error/i);
  });

  it("respects skipClarification:true with empty questions", async () => {
    stubAzureFetch({
      ...VALID_CLARIFY_RESPONSE,
      skipClarification: true,
      questions: [],
    });
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ prompt: "very detailed prompt" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipClarification).toBe(true);
    expect(body.questions).toEqual([]);
  });
});

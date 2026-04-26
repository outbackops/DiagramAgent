import { describe, it, expect, beforeEach, vi } from "vitest";
import { stubAzureFetch, stubAzureError, makeJsonRequest } from "../_test-helpers";

vi.mock("@/lib/azure-auth", () => ({
  getAzureEndpoint: () => "https://test-endpoint.openai.azure.com",
  getAuthHeaders: async () => ({ "api-key": "test-key" }),
}));

// sharp is heavy and platform-specific; mock the conversion
vi.mock("sharp", () => ({
  default: () => ({
    resize: () => ({
      png: () => ({
        toBuffer: async () => Buffer.from("fake-png-bytes"),
      }),
    }),
  }),
}));

async function loadRoute() {
  return import("./route");
}

const VALID_ASSESSMENT = {
  score: 8,
  reasoning: "Looks great",
  missing_components: [],
  layout_issues: [],
  specific_fixes: [],
};

const SAMPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect/></svg>';

describe("POST /api/assess", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 when svg or prompt missing", async () => {
    stubAzureFetch(VALID_ASSESSMENT);
    const { POST } = await loadRoute();
    expect((await POST(makeJsonRequest({}))).status).toBe(400);
    expect((await POST(makeJsonRequest({ svg: SAMPLE_SVG }))).status).toBe(400);
    expect((await POST(makeJsonRequest({ prompt: "x" }))).status).toBe(400);
  });

  it("recomputes pass server-side when score >= 7", async () => {
    stubAzureFetch({ ...VALID_ASSESSMENT, score: 8, pass: false });
    const { POST } = await loadRoute();
    const res = await POST(
      makeJsonRequest({ svg: SAMPLE_SVG, prompt: "x", d2Code: "a -> b" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Even though model said pass:false, server enforces score>=7 → true
    expect(body.assessment.score).toBe(8);
    expect(body.assessment.pass).toBe(true);
  });

  it("recomputes pass=false when score < 7 even if model says pass:true", async () => {
    stubAzureFetch({ ...VALID_ASSESSMENT, score: 5, pass: true });
    const { POST } = await loadRoute();
    const res = await POST(
      makeJsonRequest({ svg: SAMPLE_SVG, prompt: "x", d2Code: "a -> b" })
    );
    const body = await res.json();
    expect(body.assessment.score).toBe(5);
    expect(body.assessment.pass).toBe(false);
  });

  it("falls back to score=5 with parse_error on malformed JSON", async () => {
    stubAzureFetch("garbage {{{");
    const { POST } = await loadRoute();
    const res = await POST(
      makeJsonRequest({ svg: SAMPLE_SVG, prompt: "x", d2Code: "a -> b" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assessment.score).toBe(5);
    expect(body.assessment.parse_error).toBeDefined();
    expect(body.assessment.layout_issues).toContain("Assessment JSON parsing failed");
  });

  it("propagates upstream Azure errors", async () => {
    stubAzureError(500, "boom");
    const { POST } = await loadRoute();
    const res = await POST(
      makeJsonRequest({ svg: SAMPLE_SVG, prompt: "x", d2Code: "a -> b" })
    );
    expect(res.status).toBe(500);
  });

  it("normalises 'issues' field to layout_issues", async () => {
    stubAzureFetch({
      score: 4,
      reasoning: "issues found",
      issues: ["Bad alignment", "Missing arrow"],
    });
    const { POST } = await loadRoute();
    const res = await POST(
      makeJsonRequest({ svg: SAMPLE_SVG, prompt: "x", d2Code: "a -> b" })
    );
    const body = await res.json();
    expect(body.assessment.layout_issues).toEqual(["Bad alignment", "Missing arrow"]);
    expect(body.assessment.pass).toBe(false);
  });
});

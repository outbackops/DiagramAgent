// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/llm", async () => (await import("../_test-helpers")).llmModuleMock());
vi.mock("@/lib/svg-raster", () => ({ svgToPng: vi.fn(async () => Buffer.from("fake-png-bytes")) }));

import { POST } from "./route";
import { llm, makeJsonRequest } from "../_test-helpers";
import { LlmError } from "@/lib/llm/errors";

const VALID_ASSESSMENT = { score: 8, reasoning: "Looks great", missing_components: [], layout_issues: [], specific_fixes: [] };
const SAMPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect/></svg>';

describe("POST /api/assess", () => {
  beforeEach(() => {
    llm.reset();
    llm.text = JSON.stringify(VALID_ASSESSMENT);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns 400 when svg or prompt is missing", async () => {
    expect((await POST(makeJsonRequest({}))).status).toBe(400);
    expect((await POST(makeJsonRequest({ svg: SAMPLE_SVG }))).status).toBe(400);
    expect((await POST(makeJsonRequest({ prompt: "x" }))).status).toBe(400);
  });

  it("sends the rendered PNG to the reviewer model", async () => {
    await POST(makeJsonRequest({ svg: SAMPLE_SVG, prompt: "three tier app", d2Code: "a -> b" }));
    const call = llm.lastCall();
    expect(call.images).toEqual([{ mimeType: "image/png", base64: Buffer.from("fake-png-bytes").toString("base64") }]);
    expect(call.prompt).toContain("three tier app");
    expect(call.prompt).toContain("a -> b");
  });

  it("recomputes pass server-side from the score", async () => {
    llm.text = JSON.stringify({ ...VALID_ASSESSMENT, score: 8, pass: false });
    expect((await (await POST(makeJsonRequest({ svg: SAMPLE_SVG, prompt: "x" }))).json()).assessment).toMatchObject({ score: 8, pass: true });
    llm.text = JSON.stringify({ ...VALID_ASSESSMENT, score: 5, pass: true });
    expect((await (await POST(makeJsonRequest({ svg: SAMPLE_SVG, prompt: "x" }))).json()).assessment).toMatchObject({ score: 5, pass: false });
  });

  it("falls back to score 5 when the reply is not JSON", async () => {
    llm.text = "garbage {{{";
    const res = await POST(makeJsonRequest({ svg: SAMPLE_SVG, prompt: "x" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assessment.score).toBe(5);
    expect(body.assessment.parse_error).toBeDefined();
    expect(body.assessment.layout_issues).toContain("Assessment JSON parsing failed");
  });

  it("normalises an `issues` field to layout_issues", async () => {
    llm.text = JSON.stringify({ score: 4, reasoning: "issues found", issues: ["Bad alignment", "Missing arrow"] });
    const body = await (await POST(makeJsonRequest({ svg: SAMPLE_SVG, prompt: "x" }))).json();
    expect(body.assessment.layout_issues).toEqual(["Bad alignment", "Missing arrow"]);
    expect(body.assessment.pass).toBe(false);
  });

  it("refuses reviewer models that cannot see images", async () => {
    const res = await POST(makeJsonRequest({ svg: SAMPLE_SVG, prompt: "x", model: { provider: "copilot", model: "text-only" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/cannot review images/);
    expect(llm.calls).toHaveLength(0);
  });

  it("propagates provider errors", async () => {
    llm.error = new LlmError("upstream", "boom", 502);
    expect((await POST(makeJsonRequest({ svg: SAMPLE_SVG, prompt: "x" }))).status).toBe(502);
  });
});

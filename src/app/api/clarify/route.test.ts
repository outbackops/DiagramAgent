// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/llm", async () => (await import("../_test-helpers")).llmModuleMock());

import { POST } from "./route";
import { llm, makeJsonRequest } from "../_test-helpers";
import { LlmError } from "@/lib/llm/errors";
import { CLARIFY_SYSTEM_PROMPT } from "@/lib/pipeline/prompts";

const VALID = {
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

const env = process.env as Record<string, string | undefined>;
const savedNodeEnv = env.NODE_ENV;

describe("POST /api/clarify", () => {
  beforeEach(() => {
    llm.reset();
    llm.text = JSON.stringify(VALID);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    env.NODE_ENV = savedNodeEnv;
    vi.restoreAllMocks();
  });

  it("returns 400 when prompt is missing or not a string", async () => {
    const missing = await POST(makeJsonRequest({}));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toMatch(/prompt/i);
    expect((await POST(makeJsonRequest({ prompt: 42 }))).status).toBe(400);
    expect(llm.calls).toHaveLength(0);
  });

  it("returns parsed questions and the model used", async () => {
    const res = await POST(makeJsonRequest({ prompt: "Build me an HA Azure SQL setup" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.questions).toHaveLength(1);
    expect(body.questions[0].id).toBe("q1");
    expect(body.skipClarification).toBe(false);
    expect(body.analysis).toMatch(/HA\/DR/);
    expect(body.model).toEqual({ provider: "copilot", model: "claude-opus-5.5", reasoningEffort: "medium" });

    const call = llm.lastCall();
    expect(call.system).toBe(CLARIFY_SYSTEM_PROMPT);
    expect(call.prompt).toContain("HA Azure SQL setup");
    expect(call.credentials).toEqual({ kind: "machine" });
  });

  it("uses the requested model", async () => {
    await POST(makeJsonRequest({ prompt: "x", model: { provider: "copilot", model: "text-only" } }));
    expect(llm.lastCall().selection.model).toBe("text-only");
  });

  it("rejects malformed or unavailable models", async () => {
    expect((await POST(makeJsonRequest({ prompt: "x", model: { provider: "nope", model: 1 } }))).status).toBe(400);
    const unavailable = await POST(makeJsonRequest({ prompt: "x", model: { provider: "copilot", model: "gpt-unknown" } }));
    expect(unavailable.status).toBe(400);
    expect((await unavailable.json()).code).toBe("model_unavailable");
  });

  it("auto-assigns missing question ids and drops option-less questions", async () => {
    llm.text = JSON.stringify({
      ...VALID,
      questions: [{ ...VALID.questions[0], id: undefined }, { question: "No options?", type: "single", options: [] }],
    });
    const body = await (await POST(makeJsonRequest({ prompt: "anything" }))).json();
    expect(body.questions).toHaveLength(1);
    expect(body.questions[0].id).toBe("q1");
  });

  it("accepts JSON wrapped in prose or fences", async () => {
    llm.text = "Here you go:\n```json\n" + JSON.stringify(VALID) + "\n```";
    expect((await POST(makeJsonRequest({ prompt: "anything" }))).status).toBe(200);
  });

  it("returns 422 on malformed model JSON", async () => {
    llm.text = "not valid json {";
    const res = await POST(makeJsonRequest({ prompt: "anything" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/generate questions/i);
  });

  it("maps provider errors to their HTTP status", async () => {
    llm.error = new LlmError("rate_limited", "Slow down");
    const res = await POST(makeJsonRequest({ prompt: "anything" }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Slow down", code: "rate_limited" });
  });

  it("hides unexpected errors behind a generic message", async () => {
    llm.error = new Error("stack trace with secrets");
    const res = await POST(makeJsonRequest({ prompt: "anything" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Internal server error");
  });

  it("passes skipClarification through", async () => {
    llm.text = JSON.stringify({ ...VALID, skipClarification: true, questions: [] });
    const body = await (await POST(makeJsonRequest({ prompt: "very detailed prompt" }))).json();
    expect(body.skipClarification).toBe(true);
    expect(body.questions).toEqual([]);
  });

  it("requires sign-in in production", async () => {
    env.NODE_ENV = "production";
    const res = await POST(makeJsonRequest({ prompt: "anything" }));
    expect(res.status).toBe(401);
    expect(llm.calls).toHaveLength(0);
  });

  it("refuses cross-origin callers", async () => {
    const res = await POST(makeJsonRequest({ prompt: "x" }, "http://localhost/api/clarify", { host: "localhost", origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });
});

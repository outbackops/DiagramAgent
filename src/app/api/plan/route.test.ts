// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/llm", async () => (await import("../_test-helpers")).llmModuleMock());

import { POST } from "./route";
import { llm, makeJsonRequest } from "../_test-helpers";
import { LlmError } from "@/lib/llm/errors";
import { PLAN_SYSTEM_PROMPT } from "@/lib/pipeline/prompts";

const VALID_PLAN = {
  pattern: "HA/DR with SQL Always On",
  provider: "Azure",
  components: [{ name: "AppGateway", type: "resource" }],
  hierarchy: { Subscription: { PrimaryRegion: ["AppGateway"] } },
  connections: [{ from: "Users", to: "Subscription.PrimaryRegion.AppGateway", label: "HTTPS" }],
};

describe("POST /api/plan", () => {
  beforeEach(() => {
    llm.reset();
    llm.text = JSON.stringify(VALID_PLAN);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns 400 when prompt is missing or not a string", async () => {
    expect((await POST(makeJsonRequest({}))).status).toBe(400);
    expect((await POST(makeJsonRequest({ prompt: ["array"] }))).status).toBe(400);
  });

  it("returns the parsed plan", async () => {
    const res = await POST(makeJsonRequest({ prompt: "HA Azure SQL setup" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan).toMatchObject({ pattern: "HA/DR with SQL Always On", provider: "Azure" });
    const call = llm.lastCall();
    expect(call.system).toBe(PLAN_SYSTEM_PROMPT);
    expect(call.prompt).toContain("HA Azure SQL setup");
    expect(call.maxOutputTokens).toBe(8000);
  });

  it("includes analysis context when provided", async () => {
    await POST(makeJsonRequest({ prompt: "anything", analysis: { pattern: "X", provider: "Y" } }));
    expect(llm.lastCall().prompt).toContain("Expert analysis context");
    expect(llm.lastCall().prompt).toContain('"pattern": "X"');
  });

  it("returns 422 on malformed or non-object plans", async () => {
    llm.text = "not valid json {";
    expect((await POST(makeJsonRequest({ prompt: "anything" }))).status).toBe(422);
    llm.text = "[1, 2, 3]";
    expect((await POST(makeJsonRequest({ prompt: "anything" }))).status).toBe(422);
  });

  it("propagates provider errors", async () => {
    llm.error = new LlmError("rate_limited", "rate limited");
    expect((await POST(makeJsonRequest({ prompt: "anything" }))).status).toBe(429);
  });

  it("rejects oversized analysis payloads", async () => {
    const res = await POST(makeJsonRequest({ prompt: "x", analysis: { blob: "a".repeat(120_000) } }));
    expect(res.status).toBe(400);
  });
});

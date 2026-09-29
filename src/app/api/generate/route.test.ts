// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/llm", async () => (await import("../_test-helpers")).llmModuleMock());

import { POST } from "./route";
import { llm, makeJsonRequest, readSseEvents } from "../_test-helpers";
import { LlmError } from "@/lib/llm/errors";

describe("POST /api/generate", () => {
  beforeEach(() => {
    llm.reset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns 400 when prompt is missing or not a string", async () => {
    expect((await POST(makeJsonRequest({}))).status).toBe(400);
    expect((await POST(makeJsonRequest({ prompt: { not: "a string" } }))).status).toBe(400);
    expect(llm.calls).toHaveLength(0);
  });

  it("streams content events, a done event with the model, then [DONE]", async () => {
    llm.chunks = ["a -> b\n", "c -> d\n"];
    const res = await POST(makeJsonRequest({ prompt: "make a diagram" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    const events = await readSseEvents(res);
    expect(events.at(-1)).toBe("[DONE]");
    const payloads = events.slice(0, -1).map((e) => JSON.parse(e));
    expect(payloads.slice(0, 2)).toEqual([{ content: "a -> b\n" }, { content: "c -> d\n" }]);
    expect(payloads[2]).toMatchObject({ done: true, model: { model: "claude-opus-5.5" } });
  });

  it("uses the D2 system prompt and replays existing code as an edit", async () => {
    llm.chunks = ["x"];
    await readSseEvents(
      await POST(
        makeJsonRequest({
          prompt: "add a node",
          existingCode: "a -> b",
          history: [
            { role: "user", content: "earlier prompt" },
            { role: "assistant", content: "earlier reply" },
          ],
        }),
      ),
    );
    const call = llm.lastCall();
    expect(call.system).toContain("D2");
    expect(call.history?.map((t) => t.content)).toEqual(["earlier prompt", "earlier reply", "a -> b"]);
    expect(call.history?.at(-1)?.role).toBe("assistant");
    expect(call.prompt).toContain("add a node");
    expect(call.prompt).toContain("Modify the above D2 diagram");
  });

  it("reports failures inside the stream after it started", async () => {
    llm.chunks = ["partial"];
    llm.error = new LlmError("quota", "Monthly premium request quota exhausted");
    const events = await readSseEvents(await POST(makeJsonRequest({ prompt: "x" })));
    const payloads = events.filter((e) => e !== "[DONE]").map((e) => JSON.parse(e));
    expect(payloads).toContainEqual({ content: "partial" });
    expect(payloads).toContainEqual({ error: "Monthly premium request quota exhausted", code: "quota" });
    expect(events.at(-1)).toBe("[DONE]");
  });

  it("rejects unavailable models before streaming", async () => {
    const res = await POST(makeJsonRequest({ prompt: "x", model: { provider: "copilot", model: "ghost" } }));
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toContain("application/json");
  });

  it("rejects oversized history", async () => {
    const history = Array.from({ length: 41 }, () => ({ role: "user", content: "hi" }));
    expect((await POST(makeJsonRequest({ prompt: "x", history }))).status).toBe(400);
  });
});

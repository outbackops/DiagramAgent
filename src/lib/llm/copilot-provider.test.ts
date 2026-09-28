// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";

type Handler = (event: { type: string; data: Record<string, unknown>; agentId?: string }) => void;

const state = vi.hoisted(() => ({
  clientOptions: [] as Array<Record<string, unknown>>,
  sessions: [] as Array<{
    sessionId: string;
    config: Record<string, unknown>;
    sent: Array<Record<string, unknown>>;
    aborted: boolean;
    disconnected: boolean;
    emit: (type: string, data?: Record<string, unknown>, extra?: Record<string, unknown>) => void;
  }>,
  respond: null as null | ((session: { emit: (type: string, data?: Record<string, unknown>, extra?: Record<string, unknown>) => void }) => void),
  models: [] as unknown[],
  rpcModels: [] as unknown[],
  rpcCalls: [] as unknown[],
  listCalls: 0,
  deleted: [] as string[],
}));

vi.mock("@github/copilot-sdk", () => {
  let counter = 0;
  class FakeSession {
    sessionId = `s-${++counter}`;
    sent: Array<Record<string, unknown>> = [];
    aborted = false;
    disconnected = false;
    private handlers = new Set<Handler>();
    constructor(public config: Record<string, unknown>) {}
    on(handler: Handler) {
      this.handlers.add(handler);
      return () => this.handlers.delete(handler);
    }
    emit(type: string, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
      for (const h of [...this.handlers]) h({ type, data, ...extra });
    }
    async send(options: Record<string, unknown>) {
      this.sent.push(options);
      setTimeout(() => state.respond?.(this), 0);
      return "msg-1";
    }
    async abort() {
      this.aborted = true;
    }
    async disconnect() {
      this.disconnected = true;
    }
  }
  class CopilotClient {
    rpc = {
      models: {
        list: async (params: unknown) => {
          state.rpcCalls.push(params);
          return { models: state.rpcModels };
        },
      },
    };
    constructor(options: Record<string, unknown>) {
      state.clientOptions.push(options);
    }
    async start() {}
    async createSession(config: Record<string, unknown>) {
      const s = new FakeSession(config);
      state.sessions.push(s);
      return s;
    }
    async listModels() {
      state.listCalls++;
      return state.models;
    }
    async deleteSession(id: string) {
      state.deleted.push(id);
    }
    async getAuthStatus() {
      return { isAuthenticated: true, login: "octocat", statusMessage: "octocat (via gh)" };
    }
  }
  return { CopilotClient };
});

import { CopilotProvider, buildCopilotPrompt, toCatalogModel } from "./copilot-provider";
import { LlmError } from "./errors";
import type { LlmRequest } from "./types";

function resetRuntime() {
  const g = globalThis as Record<symbol, unknown>;
  delete g[Symbol.for("diagram-agent.copilot-runtime")];
  delete g[Symbol.for("diagram-agent.copilot-catalog")];
}

function baseRequest(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    selection: { provider: "copilot", model: "claude-opus-5.5", reasoningEffort: "medium" },
    credentials: { kind: "machine" },
    system: "SYSTEM PROMPT",
    prompt: "draw a -> b",
    ...overrides,
  };
}

function replyWith(chunks: string[], finalText = chunks.join("")) {
  state.respond = (session) => {
    for (const c of chunks) session.emit("assistant.message_delta", { deltaContent: c });
    session.emit("assistant.usage", { model: "claude-opus-5.5", inputTokens: 10, outputTokens: 5, reasoningEffort: "medium" });
    session.emit("assistant.message", { content: finalText });
    session.emit("session.idle");
  };
}

describe("CopilotProvider", () => {
  beforeEach(() => {
    resetRuntime();
    process.env.DIAGRAM_AGENT_COPILOT_HOME = path.join(os.tmpdir(), "diagram-agent-vitest");
    state.clientOptions.length = 0;
    state.sessions.length = 0;
    state.rpcCalls.length = 0;
    state.deleted.length = 0;
    state.listCalls = 0;
    state.models = [];
    state.rpcModels = [];
    state.respond = null;
  });

  it("starts one runtime in isolated 'empty' mode", async () => {
    replyWith(["x"]);
    const provider = new CopilotProvider();
    await provider.complete(baseRequest());
    await provider.complete(baseRequest());
    expect(state.clientOptions).toHaveLength(1);
    expect(state.clientOptions[0]).toMatchObject({
      mode: "empty",
      baseDirectory: path.join(os.tmpdir(), "diagram-agent-vitest"),
    });
  });

  it("creates a tool-less session with a replaced system prompt and the chosen model/effort", async () => {
    replyWith(["x"]);
    await new CopilotProvider().complete(baseRequest());
    const config = state.sessions[0].config;
    expect(config).toMatchObject({
      model: "claude-opus-5.5",
      reasoningEffort: "medium",
      systemMessage: { mode: "replace", content: "SYSTEM PROMPT" },
      availableTools: [],
      enableSessionStore: false,
      infiniteSessions: { enabled: false },
    });
    expect(config.gitHubToken).toBeUndefined();
  });

  it("streams deltas and returns the final message with usage", async () => {
    replyWith(["dir", "ection: right"]);
    const deltas: string[] = [];
    const result = await new CopilotProvider().stream(baseRequest(), (c) => deltas.push(c));
    expect(deltas).toEqual(["dir", "ection: right"]);
    expect(result.text).toBe("direction: right");
    expect(result.usage).toMatchObject({ model: "claude-opus-5.5", inputTokens: 10, outputTokens: 5 });
    expect(state.sessions[0].config.streaming).toBe(true);
  });

  it("ignores sub-agent events", async () => {
    state.respond = (session) => {
      session.emit("assistant.message_delta", { deltaContent: "noise" }, { agentId: "sub-1" });
      session.emit("assistant.message", { content: "root answer" });
      session.emit("session.idle");
    };
    const deltas: string[] = [];
    const result = await new CopilotProvider().stream(baseRequest(), (c) => deltas.push(c));
    expect(deltas).toEqual([]);
    expect(result.text).toBe("root answer");
  });

  it("passes a signed-in user's token per session", async () => {
    replyWith(["x"]);
    await new CopilotProvider().complete(baseRequest({ credentials: { kind: "github-token", token: "gho_test" } }));
    expect(state.sessions[0].config.gitHubToken).toBe("gho_test");
  });

  it("inlines history and attaches images as blobs", async () => {
    replyWith(["{}"]);
    await new CopilotProvider().complete(
      baseRequest({
        history: [
          { role: "user", content: "first" },
          { role: "assistant", content: "reply" },
        ],
        images: [{ mimeType: "image/png", base64: "AAAA" }],
      }),
    );
    const sent = state.sessions[0].sent[0] as { prompt: string; attachments: unknown[] };
    expect(sent.prompt).toContain("<conversation_history>");
    expect(sent.prompt).toContain("[user]\nfirst");
    expect(sent.prompt).toContain("<current_request>\ndraw a -> b");
    expect(sent.attachments).toEqual([{ type: "blob", data: "AAAA", mimeType: "image/png", displayName: "image-1.png" }]);
  });

  it("maps session errors to LlmError codes", async () => {
    state.respond = (session) => session.emit("session.error", { errorType: "rate_limit", message: "Slow down" });
    await expect(new CopilotProvider().complete(baseRequest())).rejects.toMatchObject({ code: "rate_limited", message: "Slow down" });
  });

  it("aborts the session when the caller cancels", async () => {
    state.respond = () => {};
    const controller = new AbortController();
    const pending = new CopilotProvider().complete(baseRequest({ signal: controller.signal }));
    await vi.waitFor(() => expect(state.sessions).toHaveLength(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(state.sessions[0].aborted).toBe(true);
  });

  it("times out stuck sessions", async () => {
    state.respond = () => {};
    await expect(new CopilotProvider().complete(baseRequest({ timeoutMs: 20 }))).rejects.toMatchObject({ code: "timeout" });
    expect(state.sessions[0].aborted).toBe(true);
  });

  it("always disconnects and deletes the session", async () => {
    state.respond = (session) => session.emit("session.error", { errorType: "query", message: "boom" });
    await expect(new CopilotProvider().complete(baseRequest())).rejects.toBeInstanceOf(LlmError);
    expect(state.sessions[0].disconnected).toBe(true);
    await vi.waitFor(() => expect(state.deleted).toContain(state.sessions[0].sessionId));
  });

  it("lists and caches machine models, dropping auto and disabled ones", async () => {
    state.models = [
      { id: "auto", name: "Auto", capabilities: { supports: {}, limits: {} } },
      {
        id: "claude-opus-5.5",
        name: "Claude Opus 5.5",
        capabilities: { supports: { vision: true, reasoningEffort: true }, limits: { max_context_window_tokens: 1_000_000, max_output_tokens: 128_000 } },
        supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
        policy: { state: "enabled", terms: "" },
      },
      { id: "blocked", name: "Blocked", capabilities: { supports: {}, limits: {} }, policy: { state: "disabled", terms: "" } },
    ];
    const provider = new CopilotProvider();
    const first = await provider.listModels({ kind: "machine" });
    await provider.listModels({ kind: "machine" });
    expect(state.listCalls).toBe(1);
    expect(first.map((m) => m.id)).toEqual(["claude-opus-5.5"]);
    expect(first[0]).toMatchObject({ vision: true, contextWindow: 1_000_000, reasoningEfforts: ["low", "medium", "high", "xhigh", "max"] });
  });

  it("lists models for a user token through the runtime RPC", async () => {
    state.rpcModels = [{ id: "gpt-5.5", name: "GPT-5.5", capabilities: { supports: { vision: true }, limits: {} } }];
    const models = await new CopilotProvider().listModels({ kind: "github-token", token: "gho_user" });
    expect(state.rpcCalls).toEqual([{ gitHubToken: "gho_user" }]);
    expect(models.map((m) => m.id)).toEqual(["gpt-5.5"]);
  });
});

describe("helpers", () => {
  it("leaves the prompt alone without history", () => {
    expect(buildCopilotPrompt("hello")).toBe("hello");
  });

  it("ignores unknown reasoning effort values from the runtime", () => {
    const m = toCatalogModel({
      id: "x",
      name: "X",
      capabilities: { supports: { vision: false, reasoningEffort: true }, limits: { max_context_window_tokens: 0 } },
      supportedReasoningEfforts: ["medium", "ultra" as never],
    });
    expect(m?.reasoningEfforts).toEqual(["medium"]);
  });
});

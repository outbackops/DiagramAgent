import { vi } from "vitest";
import { LlmError } from "@/lib/llm/errors";
import type { CatalogModel, LlmRequest, LlmResult, ModelSelection } from "@/lib/llm/types";

/**
 * Shared fakes for route tests. Route modules talk to models only through
 * `@/lib/llm`, so tests replace that module:
 *
 *   vi.mock("@/lib/llm", async () => (await import("../_test-helpers")).llmModuleMock());
 *
 * and drive behaviour through the exported `llm` state.
 */

export const DEFAULT_TEST_SELECTION: ModelSelection = { provider: "copilot", model: "claude-opus-5.5", reasoningEffort: "medium" };

export const TEST_CATALOG: CatalogModel[] = [
  { provider: "copilot", id: "claude-opus-5.5", name: "Claude Opus 5.5", vision: true, reasoningEfforts: ["low", "medium", "high"] },
  { provider: "copilot", id: "text-only", name: "Text Only", vision: false, reasoningEfforts: [] },
];

export const llm = {
  calls: [] as LlmRequest[],
  /** Text returned by complete(); chunks streamed by stream(). */
  text: "",
  chunks: [] as string[],
  error: null as Error | null,
  reset() {
    this.calls = [];
    this.text = "";
    this.chunks = [];
    this.error = null;
  },
  lastCall(): LlmRequest {
    const call = this.calls[this.calls.length - 1];
    if (!call) throw new Error("provider was not called");
    return call;
  },
};

export function llmModuleMock() {
  const provider = {
    id: "copilot" as const,
    isConfigured: () => true,
    listModels: async () => TEST_CATALOG,
    complete: vi.fn(async (request: LlmRequest): Promise<LlmResult> => {
      llm.calls.push(request);
      if (llm.error) throw llm.error;
      return { text: llm.text, usage: { model: request.selection.model } };
    }),
    stream: vi.fn(async (request: LlmRequest, onDelta: (chunk: string) => void): Promise<LlmResult> => {
      llm.calls.push(request);
      for (const chunk of llm.chunks) onDelta(chunk);
      if (llm.error) throw llm.error;
      return { text: llm.chunks.join(""), usage: { model: request.selection.model } };
    }),
  };
  return {
    getProvider: () => provider,
    resolveSelection: async (requested: ModelSelection | null) => {
      if (!requested) return DEFAULT_TEST_SELECTION;
      const found = TEST_CATALOG.find((m) => m.id === requested.model);
      if (!found) throw new LlmError("model_unavailable", `Model "${requested.model}" is not available for this account. Pick another model.`);
      return requested;
    },
    selectionSupportsVision: async (selection: ModelSelection) =>
      TEST_CATALOG.some((m) => m.id === selection.model && m.vision),
    listCatalog: async () => ({ models: TEST_CATALOG, defaultSelection: DEFAULT_TEST_SELECTION, errors: {} }),
    LlmError,
    isLlmError: (err: unknown) => err instanceof LlmError,
  };
}

/** Build a same-origin JSON POST the way the browser sends it. */
export function makeJsonRequest(body: unknown, url = "http://localhost/api/test", headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

export async function readSseEvents(res: Response): Promise<string[]> {
  const text = await res.text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6));
}

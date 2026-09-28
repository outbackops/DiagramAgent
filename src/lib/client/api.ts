"use client";

import type {
  ApiErrorBody,
  AuthStatusResponse,
  DeviceFlowPollResponse,
  DeviceFlowStartResponse,
  ModelsResponse,
} from "@/lib/api/types";
import type { ChatTurn, LlmUsage, ModelSelection } from "@/lib/llm/types";
import type { QualityReport } from "@/lib/quality/diagram-quality";
import type { ReviewAssessment } from "@/lib/pipeline/refine-loop";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> = {};
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    // Non-JSON error body.
  }
  return new ApiError(body.error || `Request failed (${res.status})`, res.status, body.code);
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, cache: "no-store" });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

async function postForBlob(url: string, body: unknown): Promise<Blob> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return res.blob();
}

export interface ClarifyQuestionDto {
  id: string;
  question: string;
  rationale?: string | null;
  type: "single" | "multi";
  options: { label: string; value: string }[];
}

export interface ClarifyResponseDto {
  questions: ClarifyQuestionDto[];
  analysis: unknown;
  skipClarification: boolean;
  model: ModelSelection;
}

export interface RenderResponse {
  svg: string;
  quality: QualityReport | null;
}

// Rendering is deterministic, so identical code renders are shared between
// the live canvas and the refine loop instead of hitting the server twice.
const renderCache = new Map<string, Promise<RenderResponse>>();
const RENDER_CACHE_SIZE = 12;

/** Waits before retrying when the server's single D2 engine has a full queue (503). */
const RENDER_BUSY_BACKOFF_MS = [800, 2000];

async function renderUncached(code: string, signal?: AbortSignal): Promise<RenderResponse> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      signal,
    });
    if (res.ok) return (await res.json()) as RenderResponse;
    if (res.status === 503 && attempt < RENDER_BUSY_BACKOFF_MS.length && !signal?.aborted) {
      await new Promise((resolve) => setTimeout(resolve, RENDER_BUSY_BACKOFF_MS[attempt]));
      continue;
    }
    throw await parseError(res);
  }
}

/** True when /api/render rejected the D2 itself (422), as opposed to the renderer being unavailable. */
export function isD2SyntaxError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 422;
}

/** Let one caller stop waiting on a shared promise without cancelling it for everyone else. */
function withSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function render(code: string, signal?: AbortSignal): Promise<RenderResponse> {
  let pending = renderCache.get(code);
  if (!pending) {
    // Shared promises must not be cancelled by one consumer, so the cached
    // request runs without the caller's signal.
    pending = renderUncached(code).catch((err) => {
      renderCache.delete(code);
      throw err;
    });
    renderCache.set(code, pending);
    while (renderCache.size > RENDER_CACHE_SIZE) {
      const oldest = renderCache.keys().next().value;
      if (oldest === undefined) break;
      renderCache.delete(oldest);
    }
  }
  return withSignal(pending, signal);
}

export interface GenerateInput {
  prompt: string;
  existingCode: string;
  history: ChatTurn[];
}

/** Stream D2 from /api/generate, calling onDelta with each chunk. Resolves with the full raw text. */
async function generate(
  input: GenerateInput,
  model: ModelSelection,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<{ text: string; usage?: LlmUsage; model?: ModelSelection }> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, model }),
    signal,
  });
  if (!res.ok) throw await parseError(res);
  const reader = res.body?.getReader();
  if (!reader) throw new ApiError("The server returned no stream", 502);

  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let usage: LlmUsage | undefined;
  let usedModel: ModelSelection | undefined;
  let streamError: ApiError | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") continue;
      let event: { content?: string; done?: boolean; usage?: LlmUsage; model?: ModelSelection; error?: string; code?: string };
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      if (event.content) {
        text += event.content;
        onDelta(event.content);
      } else if (event.error) {
        streamError = new ApiError(event.error, 502, event.code);
      } else if (event.done) {
        usage = event.usage;
        usedModel = event.model;
      }
    }
  }
  if (streamError) throw streamError;
  return { text, usage, model: usedModel };
}

export const api = {
  authStatus: (signal?: AbortSignal) => getJson<AuthStatusResponse>("/api/auth/status", signal),
  models: (signal?: AbortSignal) => getJson<ModelsResponse>("/api/models", signal),
  startDeviceFlow: () => postJson<DeviceFlowStartResponse>("/api/auth/device/start", {}),
  pollDeviceFlow: (flow: string) => postJson<DeviceFlowPollResponse>("/api/auth/device/poll", { flow }),
  signOut: () => postJson<{ ok: boolean }>("/api/auth/signout", {}),
  clarify: (prompt: string, model: ModelSelection, signal?: AbortSignal) =>
    postJson<ClarifyResponseDto>("/api/clarify", { prompt, model }, signal),
  plan: (prompt: string, analysis: unknown, model: ModelSelection, signal?: AbortSignal) =>
    postJson<{ plan: Record<string, unknown> }>("/api/plan", { prompt, analysis: analysis ?? undefined, model }, signal),
  assess: (input: { svg: string; prompt: string; d2Code: string }, model: ModelSelection, signal?: AbortSignal) =>
    postJson<{ assessment: ReviewAssessment }>("/api/assess", { ...input, model }, signal),
  render,
  generate,
  exportPng: (svg: string) => postForBlob("/api/export/png", { svg }),
  exportDrawio: (d2Code: string, title: string) => postForBlob("/api/export/vsdx", { d2Code, title }),
  exportVisio: (d2Code: string, title: string) => postForBlob("/api/export/visio", { d2Code, title }),
};

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFileName(title: string, fallback = "diagram"): string {
  return title.replace(/[^a-zA-Z0-9_\- ]/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || fallback;
}

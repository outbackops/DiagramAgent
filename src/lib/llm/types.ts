/**
 * Provider-agnostic LLM types shared by the Copilot and Azure providers,
 * the API routes, the eval harness, and (type-only) the UI.
 */

export type ProviderId = "copilot" | "azure";

export const REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** What the user picked in the model selector. */
export interface ModelSelection {
  provider: ProviderId;
  model: string;
  reasoningEffort?: ReasoningEffort;
}

/** A model the current identity is allowed to use. */
export interface CatalogModel {
  provider: ProviderId;
  id: string;
  name: string;
  vision: boolean;
  reasoningEfforts: ReasoningEffort[];
  defaultReasoningEffort?: ReasoningEffort;
  contextWindow?: number;
  maxOutputTokens?: number;
  /** Premium-request multiplier reported by Copilot, when known. */
  multiplier?: number;
  description?: string;
}

/** Who the request runs as. Never serialised to the browser. */
export type LlmCredentials =
  | { kind: "machine" }
  | { kind: "github-token"; token: string; login?: string };

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface LlmImage {
  mimeType: string;
  base64: string;
}

export interface LlmRequest {
  selection: ModelSelection;
  credentials: LlmCredentials;
  system: string;
  /** The current user turn. */
  prompt: string;
  /** Earlier turns, oldest first. */
  history?: ChatTurn[];
  images?: LlmImage[];
  /** Azure only — Copilot sessions pick their own output budget. */
  maxOutputTokens?: number;
  /** Azure only, and only for models that accept it. */
  temperature?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface LlmUsage {
  model?: string;
  reasoningEffort?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
}

export interface LlmResult {
  text: string;
  usage?: LlmUsage;
}

export interface LlmProvider {
  readonly id: ProviderId;
  isConfigured(): boolean;
  listModels(credentials: LlmCredentials): Promise<CatalogModel[]>;
  complete(request: LlmRequest): Promise<LlmResult>;
  stream(request: LlmRequest, onDelta: (chunk: string) => void): Promise<LlmResult>;
}

import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CopilotClient, type ModelInfo, type SessionEvent } from "@github/copilot-sdk";
import { machineLoginAllowed } from "@/lib/auth/policy";
import { LlmError, isLlmError } from "./errors";
import { isReasoningEffort } from "./selection";
import type {
  CatalogModel,
  ChatTurn,
  LlmCredentials,
  LlmProvider,
  LlmRequest,
  LlmResult,
  LlmUsage,
} from "./types";

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const CATALOG_TTL_MS = 5 * 60_000;

type SessionConfig = Parameters<CopilotClient["createSession"]>[0];
type MessageOptions = Parameters<Awaited<ReturnType<CopilotClient["createSession"]>>["send"]>[0];
type Attachments = Exclude<MessageOptions, string>["attachments"];

interface Runtime {
  client: CopilotClient;
  workDir: string;
}

const RUNTIME_KEY = Symbol.for("diagram-agent.copilot-runtime");
const CATALOG_KEY = Symbol.for("diagram-agent.copilot-catalog");

type GlobalWithRuntime = typeof globalThis & {
  [RUNTIME_KEY]?: Promise<Runtime>;
  [CATALOG_KEY]?: Map<string, { expires: number; models: Promise<CatalogModel[]> }>;
};

/**
 * Copilot state lives outside the user's ~/.copilot so DiagramAgent sessions
 * never show up in their CLI history and no repo instructions are discovered.
 */
export function copilotHomeDir(): string {
  return process.env.DIAGRAM_AGENT_COPILOT_HOME || path.join(os.homedir(), ".diagram-agent", "copilot");
}

/**
 * One runtime per server process. Stored on globalThis so Next.js dev-mode
 * module reloads reuse it instead of spawning a new runtime each time.
 */
function getRuntime(): Promise<Runtime> {
  const g = globalThis as GlobalWithRuntime;
  if (!g[RUNTIME_KEY]) {
    g[RUNTIME_KEY] = (async () => {
      const baseDirectory = copilotHomeDir();
      const workDir = path.join(baseDirectory, "work");
      await mkdir(workDir, { recursive: true });
      const client = new CopilotClient({
        // "empty" = no ambient OS tools, skills, MCP servers or CLI defaults.
        mode: "empty",
        logLevel: "error",
        baseDirectory,
        workingDirectory: workDir,
        sessionIdleTimeoutSeconds: 600,
        useLoggedInUser: machineLoginAllowed(),
      });
      await client.start();
      return { client, workDir };
    })().catch((err) => {
      delete g[RUNTIME_KEY];
      console.error("GitHub Copilot runtime start failed:", err);
      throw toLlmError(err, "Could not start the GitHub Copilot runtime", true);
    });
  }
  return g[RUNTIME_KEY]!;
}

/**
 * Drop a runtime whose connection died and kill its CLI process. The shared slot
 * is cleared only if it still holds that runtime, so when several requests hit
 * the same dead connection they don't discard a replacement another one started.
 */
async function resetRuntime(dead: Runtime): Promise<void> {
  const g = globalThis as GlobalWithRuntime;
  const current = g[RUNTIME_KEY];
  if (current && (await current.catch(() => null)) === dead && g[RUNTIME_KEY] === current) {
    delete g[RUNTIME_KEY];
  }
  await dead.client.forceStop().catch(() => {});
}

function catalogCache() {
  const g = globalThis as GlobalWithRuntime;
  g[CATALOG_KEY] ??= new Map();
  return g[CATALOG_KEY]!;
}

function credentialKey(credentials: LlmCredentials): string {
  if (credentials.kind === "machine") return "machine";
  return createHash("sha256").update(credentials.token).digest("hex").slice(0, 32);
}

export function toCatalogModel(info: ModelInfo): CatalogModel | null {
  if (!info?.id || info.id === "auto") return null;
  if (info.policy?.state === "disabled") return null;
  const efforts = (info.supportedReasoningEfforts ?? []).filter(isReasoningEffort);
  const defaultEffort = info.defaultReasoningEffort;
  return {
    provider: "copilot",
    id: info.id,
    name: info.name || info.id,
    vision: Boolean(info.capabilities?.supports?.vision),
    reasoningEfforts: efforts,
    defaultReasoningEffort: isReasoningEffort(defaultEffort) ? defaultEffort : undefined,
    contextWindow: info.capabilities?.limits?.max_context_window_tokens || undefined,
    maxOutputTokens: info.capabilities?.limits?.max_output_tokens,
    multiplier: info.billing?.multiplier,
  };
}

const ERROR_TYPE_CODES: Record<string, LlmError["code"]> = {
  authentication: "unauthenticated",
  authorization: "forbidden",
  quota: "quota",
  rate_limit: "rate_limited",
  context_limit: "bad_request",
};

function isConnectionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /connection|closed|disposed|not connected|EPIPE|ECONNRESET|exited/i.test(message);
}

function toLlmError(err: unknown, fallback: string, runtimeStart = false): LlmError {
  if (isLlmError(err)) return err;
  const message = err instanceof Error ? err.message : String(err ?? fallback);
  if (/\b401\b|unauthori[sz]ed|not authenticated|no (github )?token|login required/i.test(message)) {
    return new LlmError("unauthenticated", "GitHub Copilot sign-in required or expired. Sign in again.");
  }
  if (/\b403\b|forbidden|not entitled|no copilot/i.test(message)) {
    return new LlmError("forbidden", "This GitHub account does not have access to GitHub Copilot.");
  }
  if (runtimeStart || process.env.NODE_ENV === "production") {
    const safe = "Could not start the GitHub Copilot runtime. Check that you are signed in with `gh auth login` or `copilot login`.";
    return new LlmError("upstream", process.env.NODE_ENV === "production" ? safe : `${safe}: ${message}`);
  }
  console.error(`${fallback}:`, err);
  return new LlmError("upstream", `${fallback}: ${message}`);
}

async function withFreshRuntime<T>(operation: (runtime: Runtime) => Promise<T>): Promise<T> {
  let runtime = await getRuntime();
  try {
    return await operation(runtime);
  } catch (err) {
    if (!isConnectionError(err)) throw err;
    console.error("GitHub Copilot runtime connection failed; restarting:", err);
    await resetRuntime(runtime);
    runtime = await getRuntime();
    return operation(runtime);
  }
}

function sessionErrorToLlmError(data: { errorType?: string; message?: string; statusCode?: number }): LlmError {
  const code = (data.errorType && ERROR_TYPE_CODES[data.errorType]) || "upstream";
  const message = data.message || "GitHub Copilot request failed";
  return new LlmError(code, message, code === "upstream" && data.statusCode && data.statusCode >= 500 ? data.statusCode : undefined);
}

/** Copilot sessions take a single prompt, so earlier turns are inlined as a transcript. */
export function buildCopilotPrompt(prompt: string, history?: ChatTurn[]): string {
  if (!history || history.length === 0) return prompt;
  const transcript = history
    .map((turn) => `[${turn.role}]\n${turn.content.trim()}`)
    .join("\n\n");
  return `<conversation_history>\n${transcript}\n</conversation_history>\n\n<current_request>\n${prompt}\n</current_request>`;
}

export class CopilotProvider implements LlmProvider {
  readonly id = "copilot" as const;

  isConfigured(): boolean {
    return true;
  }

  async listModels(credentials: LlmCredentials): Promise<CatalogModel[]> {
    const cache = catalogCache();
    const key = credentialKey(credentials);
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.models;
    for (const [entryKey, entry] of cache) {
      if (entry.expires <= Date.now()) cache.delete(entryKey);
    }

    // The RPC, unlike client.listModels(), isn't memoised for the runtime's
    // lifetime, so this TTL really does pick up entitlement changes.
    const params = credentials.kind === "github-token" ? { gitHubToken: credentials.token } : {};
    const models = withFreshRuntime(async ({ client }) => {
      const infos = ((await client.rpc.models.list(params)) as { models?: ModelInfo[] }).models ?? [];
      return infos.map(toCatalogModel).filter((m): m is CatalogModel => m !== null);
    }).catch((err) => {
      cache.delete(key);
      throw toLlmError(err, "Could not list GitHub Copilot models");
    });
    cache.set(key, { expires: Date.now() + CATALOG_TTL_MS, models });
    return models;
  }

  /** Machine-level sign-in state (gh CLI or `copilot login`). */
  async getMachineAuthStatus(): Promise<{ signedIn: boolean; login?: string; detail?: string }> {
    return withFreshRuntime(async ({ client }) => {
      const status = await client.getAuthStatus();
      return { signedIn: status.isAuthenticated, login: status.login, detail: status.statusMessage };
    }).catch((err) => {
      throw toLlmError(err, "Could not read GitHub Copilot sign-in status");
    });
  }

  complete(request: LlmRequest): Promise<LlmResult> {
    return this.run(request);
  }

  stream(request: LlmRequest, onDelta: (chunk: string) => void): Promise<LlmResult> {
    return this.run(request, onDelta);
  }

  private async run(request: LlmRequest, onDelta?: (chunk: string) => void): Promise<LlmResult> {
    if (request.signal?.aborted) throw new LlmError("aborted", "Request was cancelled");
    let runtime = await getRuntime();

    const config: SessionConfig = {
      clientName: "diagram-agent",
      model: request.selection.model,
      streaming: Boolean(onDelta),
      systemMessage: { mode: "replace", content: request.system },
      availableTools: [],
      workingDirectory: runtime.workDir,
      enableSessionStore: false,
      infiniteSessions: { enabled: false },
      onPermissionRequest: () => ({ kind: "reject", feedback: "DiagramAgent sessions have no tools." }),
    };
    if (request.selection.reasoningEffort) {
      config.reasoningEffort = request.selection.reasoningEffort as SessionConfig["reasoningEffort"];
    }
    if (request.credentials.kind === "github-token") {
      config.gitHubToken = request.credentials.token;
    }

    let session: Awaited<ReturnType<CopilotClient["createSession"]>>;
    try {
      session = await runtime.client.createSession(config);
    } catch (err) {
      if (isConnectionError(err)) {
        console.error("GitHub Copilot runtime connection failed; restarting:", err);
        await resetRuntime(runtime);
        runtime = await getRuntime();
        config.workingDirectory = runtime.workDir;
        try {
          session = await runtime.client.createSession(config);
        } catch (retryErr) {
          throw toLlmError(retryErr, "Could not start a GitHub Copilot session");
        }
      } else {
        throw toLlmError(err, "Could not start a GitHub Copilot session");
      }
    }

    const started = Date.now();
    let streamed = "";
    let finalText: string | null = null;
    let usage: LlmUsage | undefined;
    let unsubscribe: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;

    try {
      // Inside the try so a cancel that landed during setup still releases the session.
      if (request.signal?.aborted) throw new LlmError("aborted", "Request was cancelled");
      const done = new Promise<void>((resolve, reject) => {
        unsubscribe = session.on((event: SessionEvent) => {
          if ("agentId" in event && event.agentId) return;
          switch (event.type) {
            case "assistant.message_delta": {
              const chunk = event.data.deltaContent ?? "";
              if (chunk) {
                streamed += chunk;
                onDelta?.(chunk);
              }
              break;
            }
            case "assistant.message":
              finalText = event.data.content ?? finalText;
              break;
            case "assistant.usage":
              usage = {
                model: event.data.model,
                reasoningEffort: event.data.reasoningEffort,
                inputTokens: event.data.inputTokens,
                outputTokens: event.data.outputTokens,
                durationMs: event.data.duration,
              };
              break;
            case "session.error":
              reject(sessionErrorToLlmError(event.data));
              break;
            case "session.idle":
              resolve();
              break;
          }
        });

        const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        timer = setTimeout(() => {
          void session.abort().catch(() => {});
          reject(new LlmError("timeout", `The model did not finish within ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);

        if (request.signal) {
          onAbort = () => {
            void session.abort().catch(() => {});
            reject(new LlmError("aborted", "Request was cancelled"));
          };
          request.signal.addEventListener("abort", onAbort, { once: true });
          if (request.signal.aborted) onAbort();
        }
      });
      done.catch(() => {});

      const attachments: Attachments = request.images?.map((image, i) => ({
        type: "blob" as const,
        data: image.base64,
        mimeType: image.mimeType,
        displayName: `image-${i + 1}.${image.mimeType.split("/")[1] ?? "png"}`,
      }));

      await session.send({
        prompt: buildCopilotPrompt(request.prompt, request.history),
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      });
      await done;

      const text = finalText ?? streamed;
      return { text, usage: { ...usage, durationMs: usage?.durationMs ?? Date.now() - started } };
    } catch (err) {
      throw toLlmError(err, "GitHub Copilot request failed");
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) request.signal?.removeEventListener("abort", onAbort);
      unsubscribe?.();
      const sessionId = session.sessionId;
      await session.disconnect().catch(() => {});
      void runtime.client.deleteSession(sessionId).catch(() => {});
    }
  }
}

export const copilotProvider = new CopilotProvider();
